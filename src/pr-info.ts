import * as bot from "idembot";
import { GetPRInfo } from "./pr-query";
import { PR as PRQueryResult, PR_repository_pullRequest } from "./schema/PR";
import { ApolloClient } from "apollo-boost"
import { InMemoryCache } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';

import moment = require("moment");

import { getCodeReviews, Opinion, Review } from "./reviews";
import { getPackagesInfo } from "./util/dt";
import { getTravisStatus, TravisResult } from "./util/travis";
import { mapDefined } from "./util/util";
import { StatusState, PullRequestReviewState, CommentAuthorAssociation, CheckConclusionState } from "../schema/globalTypes";

export const commentApprovalTokens: ReadonlyArray<string> = ["👍", ":+1:", "lgtm", "LGTM", ":shipit:"];
export const commentDisapprovalTokens: ReadonlyArray<string> = ["👎", ":-1:"];
export const mergeplzMarker = "mergeplz";

const MyName = "typescript-bot";

export enum ApprovalFlags {
    None = 0,
    Other = 1 << 0,
    Owner = 1 << 1,
    Maintainer = 1 << 2
}

export type DangerLevel =
    | "ScopedAndTested"
    | "ScopedAndUntested"
    | "ScopedAndConfiguration"
    | "NewDefinition"
    | "MultiplePackagesEdited"
    | "Infrastructure";

export interface BotFail {
    readonly type: "fail";
    readonly message: string;
}

export interface PrInfo {
    readonly type: "info";

    /**
     * The head commit of this PR (full format)
     */
    readonly headCommitOid: string;

    /**
     * The head commit of this PR (abbreviated format)
     */
    readonly headCommitAbbrOid: string;

    /**
     * True if the author of the PR is already a listed owner
     */
    readonly authorIsOwner: boolean;

    /**
     * The GitHub login of the PR author
     */
    readonly author: string;

    /**
     * The current list of owners of packages affected by this PR
     */
    readonly owners: ReadonlySet<string>;

    /**
     * True if the author wants us to merge the PR
     */
    readonly mergeIsRequested: boolean;

    /**
     * The CI status of the head commit
     */
    readonly travisResult: TravisResult;

    /**
     * A link to the log for the failing CI if it exists
     */
    readonly travisUrl: string | undefined;

    /**
     * True if the PR has a merge conflict
     */
    readonly hasMergeConflict: boolean;

    /**
     * The date the latest commit was pushed to GitHub
     */
    readonly lastCommitDate: Date;

    /**
     * A list of people who have reviewed this PR in the past, but for
     * a prior commit.
     */
    readonly reviewersWithStaleReviews: ReadonlyArray<{ reviewer: string, reviewedAbbrOid: string }>;

    /**
     * A link to the Review tab to provide reviewers with
     */
    readonly reviewLink: string;

    /**
     * True if the head commit has any failing reviews
     */
    readonly isChangesRequested: boolean;

    readonly approvals: ApprovalFlags;

    readonly dangerLevel: DangerLevel;

    /**
     * Integer count of days of inactivity
     */
    readonly stalenessInDays: number;

    readonly isFirstContribution: boolean;

    readonly isNewDefinition: boolean;
    readonly touchesPopularPackage: boolean;
}

const cache = new InMemoryCache();
const link = new HttpLink({
    uri: "https://api.github.com/graphql", headers: {
        authorization: `Bearer ${process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"]}`,
        accept: "application/vnd.github.antiope-preview+json"
    }
});

export async function getPRInfo(pr: bot.PullRequest): Promise<PrInfo | BotFail> {
    const now = new Date();
    const client = new ApolloClient({ cache, link });
    const info = await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: pr.number
        }
    });

    const prInfo = info.data.repository?.pullRequest;
    if (!prInfo) return botFail("No PR with this number exists");
    if (prInfo.author == null) return botFail("PR author does not exist");

    const headCommit = prInfo.commits.nodes?.filter(c => c?.commit.oid === prInfo.headRefOid) ?.[0]?.commit;
    if (!headCommit) {
        return botFail("Could not find the head commit");
    }

    let travisUrl: string | undefined = undefined;
    let travisResult: TravisResult;
    const checkSuite = headCommit?.checkSuites?.nodes?.[0];
    if (checkSuite) {
        switch (checkSuite.conclusion) {
            case CheckConclusionState.SUCCESS:
                travisResult = TravisResult.Pass;
                break;
            case CheckConclusionState.TIMED_OUT:
            case CheckConclusionState.CANCELLED:
            case CheckConclusionState.ACTION_REQUIRED:
            case CheckConclusionState.FAILURE:
                travisResult = TravisResult.Fail;
                travisUrl = checkSuite.url;
                break;
            case CheckConclusionState.NEUTRAL:
            default:
                travisResult = TravisResult.Pending;
                break;
        }
    } else {
        travisResult = TravisResult.Missing;
    }

    const lastCommitDate = new Date(headCommit.pushedDate);

    const fileList = noNulls(prInfo.files?.nodes);
    const categorizedFiles = fileList.map(f => categorizeFile(f.path));
    
    let dangerLevel: DangerLevel = "Infrastructure";
    

    const { owners, ownersAsLower, authorIsOwner, touchesPopularPackage } = await getPackagesInfo(
        pr.user.login,
        (await pr.getFilesRaw()).map(f => f.filename),
        // tslint:disable-next-line align
        /*maxMonthlyDownloads*/ 200000);

    const { approvals, reviewersWithStaleReviews, isChangesRequested } = analyzeReviews(prInfo, n => ownersAsLower.has(n.toLowerCase()));

    const reviewLink = `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${pr.number}/files`;
    const author = pr.user.login;
    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;
    const hasMergeConflict = prInfo.mergeable === "CONFLICTING";
    return {
        type: "info",
        dangerLevel,
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        mergeIsRequested: authorSaysReadyToMerge(prInfo),
        stalenessInDays,
        travisResult,
        author, owners,
        lastCommitDate,
        approvals,
        reviewersWithStaleReviews,
        reviewLink,
        travisUrl, hasMergeConflict,
        authorIsOwner, isFirstContribution,
        isChangesRequested, isNewDefinition, touchesPopularPackage
    };

    function botFail(message: string): BotFail {
        debugger;
        return { type: "fail", message };
    }

    function isPast(cutoff: Date): boolean {
        return +now > +cutoff;
    }

    function isOwner(login: string) {
        return ownersAsLower.has(login.toLowerCase());
    }
}

type FileLocation = ({
    kind: "test",
    package: string
} | {
    kind: "definition",
    package: string
} | {
    kind: "package-meta",
    package: string
} | {
    kind: "infrastructure"
}) & { filePath: string };


function categorizeFile(filePath: string): FileLocation {
    const typeDefinitionFile = /^types\/([^\/]+)\/(.*)\.d\.ts$/i;
    const typeTestFile = /^types\/([^\/]+)\/(.*)-tests\.ts$/i;
    const typeOtherFile = /^types\/([^\/]+)\/(.*)$/i;
    let match;
    if (match = typeDefinitionFile.exec(filePath)) {
        return { filePath, kind: "definition", package: match.groups?.[1]! };
    } else if (match = typeTestFile.exec(filePath)) {
        return { filePath, kind: "test", package: match.groups?.[1]! };
    } else if (match = typeOtherFile.exec(filePath)) {
        return { filePath, kind: "package-meta", package: match.groups?.[1]! };
    } else {
        return { filePath, kind: "infrastructure" };
    }
}

function partition<T, U extends string>(arr: ReadonlyArray<T>, sorter: (el: T) => U) {
    const res: { [K in U]?: T[] } = {};
    for (const el of arr) {
        const key = sorter(el);
        const target: T[] = res[key] ?? (res[key] = []);
        target.push(el);
    }
    return res;
}

function noNulls<T>(arr: ReadonlyArray<T | null | undefined> | null | undefined): T[] {
    if (arr == null) return [];

    return arr.filter(arr => arr != null) as T[];
}

function hasApprovalAndNoRejection(reviews: ReadonlyArray<Review>, filter: (r: Review) => boolean): boolean {
    let approve = false;
    for (const review of reviews) {
        if (!filter(review)) {
            continue;
        }
        switch (review.verdict) {
            case Opinion.Approve:
                approve = true;
                break;
            case Opinion.Reject:
                return false;
        }
    }
    return approve;
}

function addDays(date: Date, days: number): Date {
    return moment(date).add(days, "days").toDate();
}

function authorSaysReadyToMerge(info: PR_repository_pullRequest) {
    return info.comments.nodes?.some(comment => {
        if (comment?.author?.login === info.author?.login) {
            if (comment?.body.trim().toLowerCase() === "ready to merge") {
                return true;
            }
        }
        return false;
    }) ?? false;
}

function analyzeReviews(prInfo: PR_repository_pullRequest, isOwner: (name: string) => boolean) {
    const headCommitOid: string = prInfo.headRefOid;
    const reviewersWithStaleReviews: { reviewer: string, reviewedAbbrOid: string }[] = [];
    let isChangesRequested = false;
    let approvals = ApprovalFlags.None;
    for (const r of prInfo.reviews?.nodes || []) {
        // Skip nulls
        if (!r?.commit || !r?.author?.login) continue;
        // Skip self-reviews
        if (r.author.login === prInfo.author!.login) continue;

        if (r.commit.oid === headCommitOid) {
            // Review of head commit
            if (r.state === PullRequestReviewState.CHANGES_REQUESTED) {
                isChangesRequested = true;
            } else if (r.state === PullRequestReviewState.APPROVED) {
                if ((r.authorAssociation === CommentAuthorAssociation.MEMBER) || (r.authorAssociation === CommentAuthorAssociation.OWNER)) {
                    approvals |= ApprovalFlags.Maintainer;
                } else if (isOwner(r.author.login)) {
                    approvals |= ApprovalFlags.Owner;
                } else {
                    approvals |= ApprovalFlags.Other;
                }
            }
        } else {
            // Stale review
            reviewersWithStaleReviews.push({ reviewedAbbrOid: r.commit.abbreviatedOid, reviewer: r.author.login });
        }
    }

    return ({
        reviewersWithStaleReviews,
        approvals,
        isChangesRequested
    });
}