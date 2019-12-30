import * as bot from "idembot";
import fetch from "node-fetch";
import { GetPRInfo } from "./pr-query";
import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest, PR_repository_pullRequest_commits_nodes_commit, PR_repository_pullRequest } from "./schema/PR";
import { GetFileContent, GetFileExists } from "./file-query";
import { GetFileExists  as GetFileExistsResult } from "./schema/GetFileExists";
import { GetFileContent as GetFileContentResult } from "./schema/GetFileContent";
import { ApolloClient } from "apollo-boost";
import { InMemoryCache, IntrospectionFragmentMatcher } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';
import * as HeaderPaser from "definitelytyped-header-parser";

import moment = require("moment");

import { getCodeReviews, Opinion, Review } from "./reviews";
import { getPackagesInfo } from "./util/dt";
import { TravisResult } from "./util/travis";
import { mapDefined } from "./util/util";
import { StatusState, PullRequestReviewState, CommentAuthorAssociation, CheckConclusionState } from "./schema/graphql-global-types";
import { getMonthlyDownloadCount } from "./util/npm";
import { readFileSync } from "fs";

const MyName = "typescript-bot";

export enum ApprovalFlags {
    None = 0,
    Other = 1 << 0,
    Owner = 1 << 1,
    Maintainer = 1 << 2
}

const CriticalPopularityThreshold = 5_000_000;
const NormalPopularityThreshold = 200_000;

export type DangerLevel =
    | "ScopedAndTested"
    | "ScopedAndUntested"
    | "ScopedAndConfiguration"
    | "NewDefinition"
    | "MultiplePackagesEdited"
    | "Infrastructure";

export type PopularityLevel = 
    | "Well-liked by everyone"
    | "Popular"
    | "Critical";

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
    readonly owners: readonly string[];

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
    readonly approvalFlags: ApprovalFlags;
    readonly dangerLevel: DangerLevel;

    readonly ownerApprovalCount: number;
    readonly otherApprovalCount: number;
    readonly maintainerApprovalCount: number;

    /**
     * Integer count of days of inactivity from the author
     */
    readonly stalenessInDays: number;
    readonly anyPackageIsNew: boolean;

    /**
     * True if the author has dismissed any reviews against the head commit
     */
    readonly hasDismissedReview: boolean;
    readonly isFirstContribution: boolean;

    readonly popularityLevel: PopularityLevel;

    readonly packages: readonly string[];
    readonly files: readonly FileLocation[];
}

function getHeadCommit(pr: GraphqlPullRequest) {
    const headCommit = pr.commits.nodes?.filter(c => c?.commit.oid === pr.headRefOid) ?.[0]?.commit;
    return headCommit;
}

const fragmentMatcher = new IntrospectionFragmentMatcher({
    introspectionQueryResultData: {
        __schema: {
            types: []
        }
    }
});
const cache = new InMemoryCache({ fragmentMatcher });
const link = new HttpLink({
    uri: "https://api.github.com/graphql",
    headers: {
        authorization: `Bearer ${getAuthToken()}`,
        accept: "application/vnd.github.antiope-preview+json"
    },
    fetch
});
const client = new ApolloClient({ cache, link, defaultOptions: {
    query: {
      errorPolicy: "all"
    }
  }
});

function getAuthToken() {
    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOTH_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }
    return result.trim();
}

function getTravisStatus(pr: GraphqlPullRequest) {
    let travisStatus: TravisResult = TravisResult.Pending;
    let travisUrl: string | undefined = undefined;

    const headCommit = getHeadCommit(pr);
    if (headCommit !== undefined) {
        if (headCommit.status) {
            switch (headCommit.status.state) {
                case StatusState.ERROR:
                case StatusState.FAILURE:
                    travisStatus = TravisResult.Fail;
                    travisUrl = headCommit.status.contexts[0].targetUrl;
                    break;
                case StatusState.EXPECTED:
                case StatusState.PENDING:
                    travisStatus = TravisResult.Pending;
                    break;
                case StatusState.SUCCESS:
                    travisStatus = TravisResult.Pass;
                    break;
            }
        } else {
            travisStatus = TravisResult.Missing;
        }
    }
    return { travisStatus, travisUrl };
}


export async function getPRInfo(prNumber: number): Promise<PrInfo | BotFail> {
    const info = await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: prNumber
        },
        fetchPolicy: "network-only",
        fetchResults: true
    });
    
    const prInfo = info.data.repository?.pullRequest;
    console.log(JSON.stringify(prInfo, undefined, 2));
    if (!prInfo) return botFail("No PR with this number exists");
    if (prInfo.author == null) return botFail("PR author does not exist");
    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botFail("No head commit");
    
    const categorizedFiles = noNulls(prInfo.files?.nodes).map(f => categorizeFile(f.path));
    const packages = getPackagesTouched(categorizedFiles);

    const { anyPackageIsNew, allOwners } = await getOwnersOfPackages(packages);
    const owners = Array.from(allOwners.keys());
    const authorIsOwner = isOwner(prInfo.author.login);
    const { travisStatus, travisUrl } = getTravisStatus(prInfo);

    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;

    const reviews = partition(prInfo.reviews?.nodes ?? [], e => e?.commit?.oid === headCommit.oid ? "fresh" : "stale");
    const freshReviewsByState = partition(noNulls(prInfo.reviews?.nodes), r => r.state);
    const rejections = noNulls(freshReviewsByState.CHANGES_REQUESTED);
    const approvals = noNulls(freshReviewsByState.APPROVED);
    const hasDismissedReview = !!freshReviewsByState.DISMISSED?.length;
    const approvalsByRole = partition(approvals, review => {
        if (review?.author?.login === prInfo.author?.login) {
            return "self";
        }
        if (review?.authorAssociation === "OWNER" || review?.authorAssociation === "MEMBER") {
            // DefinitelyTyped maintainer
            return "maintainer";
        }
        if (owners.indexOf(review?.author?.login || "") >= 0) {
            // Known package owner
            return "owner";
        }
        return "other";
    });

    return {
        type: "info",
        author: prInfo.author.login,
        owners,
        dangerLevel: getDangerLevel(categorizedFiles),
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        mergeIsRequested: authorSaysReadyToMerge(prInfo),
        stalenessInDays: Math.floor(moment().diff(moment(headCommit.pushedDate), "days")),
        lastCommitDate: headCommit.pushedDate,
        reviewLink: `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${prInfo.number}/files`,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        authorIsOwner, isFirstContribution,
        popularityLevel: await getPopularityLevel(packages),
        anyPackageIsNew,
        packages,
        files: categorizedFiles,
        otherApprovalCount: approvalsByRole.other?.length ?? 0,
        ownerApprovalCount: approvalsByRole.owner?.length ?? 0,
        maintainerApprovalCount: approvalsByRole.maintainer?.length ?? 0,
        hasDismissedReview,
        ...getTravisResult(headCommit),
        ...analyzeReviews(prInfo, isOwner)
    };

    function botFail(message: string): BotFail {
        debugger;
        return { type: "fail", message };
    }

    function isOwner(login: string) {
        return owners.some(k => k.toLowerCase() === login.toLowerCase());
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

async function getOwnersOfPackages(packages: readonly string[]) {
    const allOwners = new Set<string>();
    let anyPackageIsNew = false;
    for (const p of packages) {
        const owners = await getOwnersForPackage(p);
        if (owners === undefined) {
            anyPackageIsNew = true;
        } else {
            for (const o of owners) {
                allOwners.add(o);
            }
        }
    }
    return { allOwners, anyPackageIsNew };
}


async function getOwnersForPackage(packageName: string): Promise<string[] | undefined> {
    debugger;
    const indexDts = `master:types/${packageName}/index.d.ts`;
    const indexDtsContent = await fetchFile(indexDts);
    if (indexDtsContent === undefined) return undefined;

    try {
        const parsed = HeaderPaser.parseHeaderOrFail(indexDtsContent);
        return parsed.contributors.map(c => c.githubUsername).filter(notUndefined);
    } catch(e) {
        console.error(e);
        return undefined;
    }
}

async function fileExists(filename: string): Promise<boolean> {
    const info = await client.query<GetFileExistsResult>({
        query: GetFileExists,
        variables: {
            name: "DefinitelyTyped",
            owner: "DefinitelyTyped",
            expr: `master:${filename}`
        }
    });
    if (info.data.repository?.object?.__typename === "Blob") {
        return !!(info.data.repository?.object?.id);
    }
    return false;
}

async function fetchFile(expr: string): Promise<string | undefined> {
    const info = await client.query<GetFileContentResult>({
        query: GetFileContent,
        variables: {
            name: "DefinitelyTyped",
            owner: "DefinitelyTyped",
            expr: `${expr}`
        }
    });

    if (info.data.repository?.object?.__typename === "Blob") {
        return info.data.repository.object.text ?? undefined;
    }
    return undefined;
}

function categorizeFile(filePath: string): FileLocation {
    const typeDefinitionFile = /^types\/([^\/]+)\/(.*)\.d\.ts$/i;
    const typeTestFile = /^types\/([^\/]+)\/(.*)\.ts$/i;
    const typeOtherFile = /^types\/([^\/]+)\/(.*)$/i;
    let match;
    if (match = typeDefinitionFile.exec(filePath)) {
        return { filePath, kind: "definition", package: match[1] };
    } else if (match = typeTestFile.exec(filePath)) {
        return { filePath, kind: "test", package: match[1] };
    } else if (match = typeOtherFile.exec(filePath)) {
        return { filePath, kind: "package-meta", package: match[1] };
    } else {
        return { filePath, kind: "infrastructure" };
    }
}

function getPackagesTouched(files: readonly FileLocation[]) {
    const list: string[] = [];
    for (const f of files) {
        if ("package" in f) {
            if (list.indexOf(f.package) < 0) {
                list.push(f.package);
            }
        }
    }
    return list;
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
    const hasUpToDateReview: Set<string> = new Set();
    const headCommitOid: string = prInfo.headRefOid;
    const reviewersWithStaleReviews: { reviewer: string, reviewedAbbrOid: string }[] = [];
    let isChangesRequested = false;
    let approvalFlags = ApprovalFlags.None;
    
    // Do this in reverse order so we can detect up-to-date-reviews correctly
    const reviews = [...prInfo.reviews?.nodes ?? []].reverse();

    for (const r of reviews) {
        // Skip nulls
        if (!r?.commit || !r?.author?.login) continue;
        // Skip self-reviews
        if (r.author.login === prInfo.author!.login) continue;

        if (r.commit.oid === headCommitOid) {
            // Review of head commit
            hasUpToDateReview.add(r.author.login);
            if (r.state === PullRequestReviewState.CHANGES_REQUESTED) {
                isChangesRequested = true;
            } else if (r.state === PullRequestReviewState.APPROVED) {
                if ((r.authorAssociation === CommentAuthorAssociation.MEMBER) || (r.authorAssociation === CommentAuthorAssociation.OWNER)) {
                    approvalFlags |= ApprovalFlags.Maintainer;
                } else if (isOwner(r.author.login)) {
                    approvalFlags |= ApprovalFlags.Owner;
                } else {
                    approvalFlags |= ApprovalFlags.Other;
                }
            }
        } else {
            // Stale review
            // Reviewers with reviews of the current commit are not stale
            if (!hasUpToDateReview.has(r.author.login)) {
                reviewersWithStaleReviews.push({ reviewedAbbrOid: r.commit.abbreviatedOid, reviewer: r.author.login });
            }
        }
    }

    return ({
        reviewersWithStaleReviews,
        approvalFlags,
        isChangesRequested
    });
}

function getDangerLevel(categorizedFiles: readonly FileLocation[]) {
    if (categorizedFiles.some(f => f.kind === "infrastructure")) {
        return "Infrastructure";
    } else {
        const packagesTouched = getPackagesTouched(categorizedFiles);
        if (packagesTouched.length === 0) {
            // ????
            return "Infrastructure";
        } else if (packagesTouched.length === 1) {
            const packageName = packagesTouched[0];
            let tested = false;
            let meta = false;
            for (const f of categorizedFiles) {
                switch (f.kind) {
                    case "infrastructure":
                        throw new Error("impossible");
                    case "definition":
                        // Expected
                        break;
                    case "test":
                        tested = true;
                        break;
                    case "package-meta":
                        meta = true;
                        break;
                    default:
                        assertNever(f);
                }
            }
            if (meta) {
                return "ScopedAndConfiguration";
            } else if (tested) {
                return "ScopedAndTested";
            } else {
                return "ScopedAndUntested";
            }
        } else {
            return "MultiplePackagesEdited";
        }
    }
}

function assertNever(n: never) {
    throw new Error("impossible");
}

function getTravisResult(headCommit: PR_repository_pullRequest_commits_nodes_commit) {
    let travisUrl: string | undefined = undefined;
    let travisResult: TravisResult;
    const checkSuite = headCommit.checkSuites?.nodes?.[0];
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
    return { travisResult, travisUrl };
}

async function getPopularityLevel(packagesTouched: string[]): Promise<PopularityLevel> {
    let popularityLevel: PopularityLevel = "Well-liked by everyone";
    for (const p of packagesTouched) {
        const downloads = await getMonthlyDownloadCount(p);
        if (downloads > CriticalPopularityThreshold) {
            // Can short-circuit
            return "Critical";
        } else if (downloads > NormalPopularityThreshold) {
            popularityLevel = "Popular";
        }
    }
    return popularityLevel;
}

function notUndefined<T>(arg: T | undefined): arg is T { return arg !== undefined; }

