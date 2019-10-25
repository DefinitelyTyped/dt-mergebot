import * as bot from "idembot";
import { GetPRInfo } from "./pr-query";
import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest } from "./schema/PR";
import { ApolloClient } from "apollo-boost"
import { InMemoryCache } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';

import moment = require("moment");

import { getCodeReviews, Opinion, Review } from "./reviews";
import { getPackagesInfo } from "./util/dt";
import { getTravisStatus, TravisResult } from "./util/travis";
import { mapDefined } from "./util/util";
import { StatusState, PullRequestReviewState } from "../schema/globalTypes";

const MyName = "typescript-bot";

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
    readonly reviewersWithStaleReviews: ReadonlyArray<string>;

    /**
     * A link to the Review tab to provide reviewers with
     */
    readonly reviewLink: string;

    /**
     * True if the head commit has any failing reviews
     */
    readonly isChangesRequested: boolean;

    readonly ownerApprovalCount: number;
    readonly otherApprovalCount: number;
    readonly maintainerApprovalCount: number;

    /**
     * Integer count of days of inactivity from the author
     */
    readonly stalenessInDays: number;

    /**
     * True if the author has dismissed any reviews against the head commit
     */
    readonly hasDismissedReview: boolean;

    readonly isNewDefinition: boolean;
    readonly isWaitingForReviews: boolean;
    readonly touchesPopularPackage: boolean;
}

const cache = new InMemoryCache();
const link = new HttpLink({ uri: "https://api.github.com/graphql" });
const client = new ApolloClient({ cache, link });

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

function getHeadCommit(pr: GraphqlPullRequest) {
    const headCommit = pr.commits.nodes?.filter(c => c?.commit.oid === pr.headRefOid) ?.[0]?.commit;
    return headCommit;
}

export async function getPRInfo(pr: bot.PullRequest): Promise<PrInfo | BotFail> {
    const now = new Date();
    const info = await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: pr.number
        }
    });

    const prInfo = info.data.repository?.pullRequest;
    if (!prInfo) return botFail("No PR with this number exists");
    if (prInfo.author == null) return botFail("PR author does not exist");
    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botFail("No head commit");
    
    const hasMergeConflict = prInfo.mergeable === "CONFLICTING";
    const { travisStatus, travisUrl } = getTravisStatus(prInfo);
    const travisFailed = travisStatus === TravisResult.Fail;
    const lastCommitDate = new Date(headCommit.pushedDate);

    const fileList = prInfo.files!.nodes!;

    const { owners, ownersAsLower, authorIsOwner, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages } = await getPackagesInfo(
        pr.user.login,
        (await pr.getFilesRaw()).map(f => f.filename),
        // tslint:disable-next-line align
        /*maxMonthlyDownloads*/ 200000);


    const reviews = partition(prInfo.reviews?.nodes ?? [], e => e?.commit?.oid === headCommit.oid ? "fresh" : "stale");
    const freshReviewsByState = partition(noNulls(prInfo.reviews?.nodes), r => r.state);
    const rejections = noNulls(freshReviewsByState.CHANGES_REQUESTED);
    const approvals = noNulls(freshReviewsByState.APPROVED);
    const hasDismissedReview = !!freshReviewsByState.DISMISSED?.length;
    const approvalsByRole = partition(approvals, review => {
        if (review?.author?.login === prInfo.author?.login) {
            return "self";
        }
        if (review?.authorAssociation === "OWNER") {
            // DefinitelyTyped maintainer
            return "maintainer";
        }
        if (owners.has(review?.author?.login || "")) {
            // Known package owner
            return "owner";
        }
        return "other";        
    });

    const ownerApprovalCount = approvalsByRole.owner?.length ?? 0;
    const otherApprovalCount = approvalsByRole.other?.length ?? 0;
    const maintainerApprovalCount = approvalsByRole.maintainer?.length ?? 0;

    // People who reviewed a commit that isn't the latest and also didn't review the latest commit
    const staleReviewersWithNoUpdate = reviews.stale?.filter(r => !reviews.fresh?.some(fr => fr?.author?.login === r?.author?.login)).map(r => r?.author?.login as string | undefined);
    const reviewPingList: ReadonlyArray<string> = noNulls(staleReviewersWithNoUpdate);

    const files = await pr.getFilesRaw();
    const isNewDefinition = files.some(file => file.status === "added" && file.filename.endsWith("/tsconfig.json"));
    const isUnowned = !isNewDefinition && ownersAsLower.size === 0;

    const unmergeable = hasMergeConflict || travisFailed || (rejections.length > 0);

    const isLGTM = isApprovedByOther && isPast(addDays(lastCommitDate, 3)) && !unmergeable;
    const isYSYL = !(isApprovedByOther || isApprovedByOwner) && isPast(addDays(lastCommitDate, 5)) && !unmergeable;

    const isWaitingForReviews = !(unmergeable || isChangesRequested || isApprovedByOwner || isLGTM);

    // The abandoned cutoff is 7 days after a failing Travis build,
    // or 7 days after the last negative review if Travis is passing
    const lastBadEvent: Date | undefined = travisFailed
        ? lastCommitDate
        : firstBadReview === undefined ? undefined : firstBadReview.date;
    const isAbandoned = lastBadEvent !== undefined && isPast(addDays(lastBadEvent, 7));
    const isNearlyAbandoned = lastBadEvent !== undefined && isPast(addDays(lastBadEvent, 6));
    const reviewLink = `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${pr.number}/files`;

    const author = pr.user.login, mergeAuto = false;
    return {
        type: "info",
        author, owners,
        lastCommitDate,
        mergeIsRequested, mergeAuto,
        reviewLink, reviewPingList,
        travisResult, travisUrl, hasMergeConflict,
        authorIsOwner,
        hasDismissedReview,
        ownerApprovalCount,
        otherApprovalCount,
        maintainerApprovalCount,
        isChangesRequested, isApprovedByOwner, isApprovedByOther, isLGTM, isYSYL, isUnowned, isNewDefinition, touchesPopularPackage,
        isWaitingForReviews, isAbandoned, isNearlyAbandoned
    };

    function botFail(message: string): BotFail {
        debugger;
        return { type: "fail", message };
    }

    function isPast(cutoff: Date): boolean {
        return +now > +cutoff;
    }
}

function partition<T, U extends string>(arr: ReadonlyArray<T>, sorter: (el: T) => U) {
    const res: { [K in U]?: T[] } = { };
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

function getCommentTagFromBody(body: string): string | undefined {
    
}

function maybe<T>(x: T): T | undefined {
    return x;
}
