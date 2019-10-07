import * as bot from "idembot";
import { GetPRInfo } from "./pr-query";
import { PR as PRQueryResult } from "./schema/PR";
import { ApolloClient } from "apollo-boost"
import { InMemoryCache } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';

import moment = require("moment");

import { getCodeReviews, Opinion, Review } from "./reviews";
import { getPackagesInfo } from "./util/dt";
import { getTravisStatus, TravisResult } from "./util/travis";
import { mapDefined } from "./util/util";
import { StatusState, PullRequestReviewState } from "../schema/globalTypes";

export const commentApprovalTokens: ReadonlyArray<string> = ["👍", ":+1:", "lgtm", "LGTM", ":shipit:"];
export const commentDisapprovalTokens: ReadonlyArray<string> = ["👎", ":-1:"];
export const mergeplzMarker = "mergeplz";

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

    /**
     * True if the head commit is approved by a listed owner
     */
    readonly isApprovedByOwner: boolean;

    /**
     * True if the head commit is approved by someone else
     */
    readonly isApprovedByOther: boolean;

    /**
     * Integer count of days of inactivity
     */
    readonly stalenessInDays: number;


    readonly isNewDefinition: boolean;
    readonly isWaitingForReviews: boolean;
    readonly touchesPopularPackage: boolean;
}

const cache = new InMemoryCache();
const link = new HttpLink({ uri: "https://api.github.com/graphql" });
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

    const hasMergeConflict = prInfo.mergeable === "CONFLICTING";
    let travisStatus: TravisResult;
    let travisUrl: string | undefined = undefined;

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
            default:
                return botFail("Unknown bot status");
        }
    } else {
        travisStatus = TravisResult.Missing;
    }
    const travisFailed = travisStatus === TravisResult.Fail;
    const lastCommitDate = new Date(headCommit.pushedDate);

    const fileList = prInfo.files!.nodes!;

    const { owners, ownersAsLower, authorIsOwner, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages } = await getPackagesInfo(
        pr.user.login,
        (await pr.getFilesRaw()).map(f => f.filename),
        // tslint:disable-next-line align
        /*maxMonthlyDownloads*/ 200000);

    void touchesMultiplePackages, touchesNonPackage;

    const reviewsOfLatestCommit = prInfo.reviews?.nodes?.filter(r => r?.commit?.oid === headCommit.oid) || [];

    const rejections = noNulls(reviewsOfLatestCommit.filter(review => review?.state === PullRequestReviewState.CHANGES_REQUESTED));
    const approvals = noNulls(reviewsOfLatestCommit.filter(review => review?.state === PullRequestReviewState.APPROVED));

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

    const isMergeRequested = noNulls(prInfo.comments?.nodes).filter(comment => {
        // Skip comments that aren't the bot
        if (comment.author?.login !== MyName) return false;

        const tag = getCommentTagFromBody(comment.body);
        if (tag === getMergeOfferTag(headCommit.oid)) {
            for (const reaction of noNulls(comment.reactions.nodes)) {
                if (reaction.user?.login === prInfo.author?.login) {
                    return true;
                }
            }
        }
        return false;
    });

    const { reviews, mergeRequesters } = await getCodeReviews(pr);
    // Check for approval (which may apply to a prior commit; assume PRs do not regress in this fashion)
    const isApprovedByOwner = hasApprovalAndNoRejection(reviews, r => ownersAsLower.has(r.reviewer.toLowerCase()));
    const isApprovedByOther = hasApprovalAndNoRejection(reviews, r => !ownersAsLower.has(r.reviewer.toLowerCase()));
    const isChangesRequested = reviews.some(r => r.verdict === Opinion.Reject);

    // If a fresh review is a rejection, mark needs CR
    const firstBadReview = reviews.find(r => r.date >= lastCommitDate && r.verdict === Opinion.Reject);

    // Ping people whose non-approval needs a refresh based on new code changes
    const reviewPingList: ReadonlyArray<string> = mapDefined(reviews, r =>
        r.date >= lastCommitDate || r.verdict === Opinion.Approve ? undefined : r.reviewer);

    const files = await pr.getFilesRaw();
    const isNewDefinition = files.some(file => file.status === "added" && file.filename.endsWith("/tsconfig.json"));
    const isUnowned = !isNewDefinition && ownersAsLower.size === 0;

    const unmergeable = hasMergeConflict || travisFailed || firstBadReview !== undefined;

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
        mergeRequesters, mergeAuto,
        reviewLink, reviewPingList,
        travisResult, travisUrl, hasMergeConflict,
        authorIsOwner,
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

function getMergeOfferTag(oid: string) {
    return `merge-offer-${oid}`;
}

function getCommentTagFromBody(body: string): string | undefined {
    
}