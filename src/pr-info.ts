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

export const commentApprovalTokens: ReadonlyArray<string> = ["👍", ":+1:", "lgtm", "LGTM", ":shipit:"];
export const commentDisapprovalTokens: ReadonlyArray<string> = ["👎", ":-1:"];
export const mergeplzMarker = "mergeplz";

export interface PrInfo {
    readonly authorIsOwner: boolean;
    readonly author: string;
    readonly owners: ReadonlySet<string>;
    readonly mergeRequesters: ReadonlyArray<string>;
    readonly mergeAuto: boolean;

    readonly travisResult: TravisResult;
    readonly travisUrl: string | undefined;
    readonly hasMergeConflict: boolean;
    readonly lastCommitDate: Date;

    readonly reviewPingList: ReadonlyArray<string>;
    readonly reviewLink: string;

    readonly isChangesRequested: boolean;
    readonly isApprovedByOwner: boolean;
    readonly isApprovedByOther: boolean;
    readonly isLGTM: boolean;
    readonly isYSYL: boolean;
    readonly isUnowned: boolean;
    readonly isNewDefinition: boolean;
    readonly isWaitingForReviews: boolean;
    readonly isAbandoned: boolean;
    readonly isNearlyAbandoned: boolean;

    readonly touchesPopularPackage: boolean;
}

const cache = new InMemoryCache();
const link = new HttpLink({ uri: "https://api.github.com/graphql" });
export async function getPRInfo(pr: bot.PullRequest): Promise<PrInfo> {
    const client = new ApolloClient({ cache, link });
    const info = await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: pr.number
        }
    });
    
    const prInfo = info.data.repository!.pullRequest!;

    void prInfo;

    const now = new Date();
    function isPast(cutoff: Date): boolean {
        return +now > +cutoff;
    }

    const lastCommit = prInfo.commits.nodes![prInfo.commits.nodes!.length - 1]!.commit;
    const hasMergeConflict = prInfo.mergeable === "CONFLICTING";
    const travisStatus = lastCommit.status!;
    const travisFailed = travisStatus.state === "FAILURE";
    const lastCommitDate =  new Date(lastCommit.pushedDate);

    const fileList = prInfo.files!.nodes!;

    const { owners, ownersAsLower, authorIsOwner, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages } = await getPackagesInfo(
        pr.user.login,
        (await pr.getFilesRaw()).map(f => f.filename),
        // tslint:disable-next-line align
        /*maxMonthlyDownloads*/ 200000);

    void touchesMultiplePackages, touchesNonPackage;

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
        author, owners,
        lastCommitDate,
        mergeRequesters, mergeAuto,
        reviewLink, reviewPingList,
        travisResult, travisUrl, hasMergeConflict,
        authorIsOwner,
        isChangesRequested, isApprovedByOwner, isApprovedByOther, isLGTM, isYSYL, isUnowned, isNewDefinition, touchesPopularPackage,
        isWaitingForReviews, isAbandoned, isNearlyAbandoned
    };
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
