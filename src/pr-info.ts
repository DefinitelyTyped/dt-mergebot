import * as bot from "idembot";
import moment = require("moment");

import { getCodeReviews, Opinion, Review } from "./reviews";
import { getPackagesInfo } from "./util/dt";
import { getTravisStatus, TravisResult } from "./util/travis";
import { mapDefined } from "./util/util";

export const commentApprovalTokens: ReadonlyArray<string> = ["👍", ":+1:", "lgtm", "LGTM", ":shipit:"];
export const mergeplzMarker = "mergeplz";

export interface PrInfo {
    readonly kind: InfoKind;
    readonly travisResult: TravisResult;
    readonly reviewPingList: ReadonlyArray<string>;
    readonly isOwnerApproved: boolean;
    readonly isOtherApproved: boolean;
    readonly isUnowned: boolean;
    readonly isNewDefinition: boolean;
    readonly touchesPopularPackage: boolean;
}

export enum InfoKind {
    TravisFailed = "travis failed",
    HasMergeConflict = "has merge conflict",
    NeedsRevision = "needs revision",
    MergeAuto = "merge auto",
    MergeExpress = "merge express",
    MergeLgtm = "merge LGTM",
    MergeYsyl = "merge YSYL",
    Abandoned = "abandoned",
    Waiting = "waiting",
}

export async function getPRInfo(pr: bot.PullRequest): Promise<PrInfo> {
    // See if there's a merge conflict
    const hasMergeConflict = await pr.getMergeableState() === false;

    // Get Travis status
    const travisResult = await getTravisStatus(pr);
    const travisFailed = travisResult === TravisResult.Fail;

    const lastCommitDate = await getLastCommitDate(pr);

    const { owners, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages } = await getPackagesInfo(
        pr.repository.reference,
        (await pr.getFilesRaw()).map(f => f.filename),
        // tslint:disable-next-line align
        /*maxMonthlyDownloads*/ 200000);

    const { reviews, mergeRequesters } = await getCodeReviews(pr);
    // Check for approval (which may apply to a prior commit; assume PRs do not regress in this fashion)
    const isOwnerApproved = hasApprovalAndNoRejection(reviews, r => owners.has(r.reviewer));
    const isOtherApproved = hasApprovalAndNoRejection(reviews, r => !owners.has(r.reviewer));

    // If a fresh review is a rejection, mark needs CR
    const firstBadReview = reviews.find(r => r.date >= lastCommitDate && r.verdict === Opinion.Reject);

    // Ping people whose non-approval needs a refresh based on new code changes
    const reviewPingList: ReadonlyArray<string> = mapDefined(reviews, r =>
        r.date >= lastCommitDate || r.verdict === Opinion.Approve ? undefined : r.reviewer);

    const files = await pr.getFilesRaw();
    const isNewDefinition = files.some(file => file.status === "added" && file.filename.endsWith("/tsconfig.json"));
    const isUnowned = !isNewDefinition && owners.size === 0;

    const kind = (() => { // tslint:disable-line cyclomatic-complexity
        if (travisFailed) {
            return InfoKind.TravisFailed;
        }
        if (hasMergeConflict) {
            return InfoKind.HasMergeConflict;
        }
        const unmergeable = hasMergeConflict || travisFailed || firstBadReview !== undefined;
        if (unmergeable) {
            return InfoKind.NeedsRevision;
        }

        const now = new Date();
        function isPast(cutoff: Date): boolean {
            return +now > +cutoff;
        }

        if (!unmergeable && travisResult === TravisResult.Pass) {
            if (isOwnerApproved) {
                if (mergeRequesters.some(u => owners.has(u))
                    && !touchesNonPackage
                    && !touchesPopularPackage
                    && !touchesMultiplePackages
                    && isPast(addDays(pr.created_at.toDate(), 2))) {
                    return InfoKind.MergeAuto;
                }
                return InfoKind.MergeExpress;
            }

            if (isOtherApproved && isPast(addDays(lastCommitDate, 3))) {
                return InfoKind.MergeLgtm;
            }

            if (isPast(addDays(lastCommitDate, 5))) {
                return InfoKind.MergeYsyl;
            }
        } else if (unmergeable) {
            // The abandoned cutoff is 7 days after a failing Travis build,
            // or 7 days after the last negative review if Travis is passing
            const lastBadEvent: Date | undefined = travisFailed
                ? lastCommitDate
                : firstBadReview === undefined ? undefined : firstBadReview.date;
            if (lastBadEvent !== undefined && isPast(addDays(lastBadEvent, 7))) {
                return InfoKind.Abandoned;
            }
        }

        return InfoKind.Waiting;
    })();

    return {
        kind, travisResult, reviewPingList,
        isOwnerApproved, isOtherApproved, isUnowned, isNewDefinition, touchesPopularPackage,
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

async function getLastCommitDate(pr: bot.PullRequest): Promise<Date> {
    const commits = await pr.getCommitsRaw();
    return new Date(commits[commits.length - 1].commit.committer.date);
}

function addDays(date: Date, days: number): Date {
    return moment(date).add(days, "days").toDate();
}
