import crypto = require("crypto");

import { InfoKind, PrInfo } from "./pr-info";
import { ProjectColumn } from "./project";
import { TravisResult } from "./util/travis";

export function getProjectColumn({ kind, isNewDefinition, isUnowned }: PrInfo): ProjectColumn | undefined {
    switch (kind) {
        case InfoKind.TravisFailed:
        case InfoKind.HasMergeConflict:
        case InfoKind.NeedsRevision:
        case InfoKind.MergeAuto:
            return undefined;
        case InfoKind.MergeExpress:
            return ProjectColumn.MergeExpress;
        case InfoKind.MergeLgtm:
            return ProjectColumn.MergeLGTM;
        case InfoKind.MergeYsyl:
            return ProjectColumn.MergeYSYL;
        case InfoKind.Abandoned:
        case InfoKind.Waiting:
            return isNewDefinition ? ProjectColumn.NewDefinitions : isUnowned ? ProjectColumn.Unowned : undefined;
    }
}

export function getLabels(info: PrInfo): { readonly [label: string]: boolean } {
    const labels = {
        "Author Approved": info.isOwnerApproved,
        "Other Approved": info.isOtherApproved,
        "Where is Travis?": info.travisResult === TravisResult.Missing,
        "Unowned": info.isUnowned,
        "New Definition": info.isNewDefinition,
        "Popular package": info.touchesPopularPackage,
    };
    getKindLabels(labels, info.kind);
    return labels;
}
function getKindLabels(labels: { [key: string]: boolean }, kind: InfoKind): void {
    for (const key in InfoKind) { // tslint:disable-line forin
        const value = InfoKind[key];
        const label = kindToLabel(value as InfoKind);
        if (label !== undefined) {
            labels[label] = value === kind;
        }
    }
}
function kindToLabel(kind: InfoKind): string | undefined {
    switch (kind) {
        case InfoKind.TravisFailed:
            return "The Travis CI build failed";
        case InfoKind.HasMergeConflict:
            return "Has Merge Conflict";
        case InfoKind.NeedsRevision:
            return "Revision needed";
        case InfoKind.Abandoned:
            return "Abandoned";
        case InfoKind.MergeAuto:
            return "Merge:Auto";
        case InfoKind.MergeExpress:
            return "Merge:Express";
        case InfoKind.MergeLgtm:
            return "Merge:LGTM";
        case InfoKind.MergeYsyl:
            return "Merge:YSYL";
        case InfoKind.Waiting:
            return undefined;
    }
}

export interface Comment {
    readonly tag: string;
    readonly status: string;
}
export function getComments({ kind, reviewPingList, travisResult }: PrInfo, user: string): ReadonlyArray<Comment> {
    const comments: Comment[] = [];
    const mainComment = getMainComment(kind, user);
    if (mainComment !== undefined) {
        comments.push(mainComment);
    }
    const travisComment = getTravisComment(travisResult, reviewPingList, user);
    if (travisComment !== undefined) {
        comments.push(travisComment);
    }
    return comments;
}
function getMainComment(kind: InfoKind, user: string): Comment | undefined {
    switch (kind) {
        case InfoKind.TravisFailed:
            return { tag: "complaint", status: `@${user} Please fix the failures indicated in the Travis CI log.` };
        case InfoKind.HasMergeConflict:
            return { tag: "complaint", status: `@${user} Please address the merge conflict.` };
        case InfoKind.NeedsRevision:
            return { tag: "complaint", status: `@${user} Please address comments from the code reviewers.` };
        case InfoKind.MergeExpress:
            return {
                tag: "merge",
                status: "Approved by a listed owner. PR ready to merge pending express review by a maintainer.",
            };
        case InfoKind.MergeLgtm:
            return {
                tag: "merge",
                status: "Approved by third party. PR appears ready to merge pending review by a maintainer.",
            };
        case InfoKind.MergeYsyl:
            return {
                tag: "merge",
                status: "This PR has been open and unchanged 5 days without signoff or complaint. " +
                    "This will be merged by a maintainer soon if there are no objections.",
            };
        case InfoKind.Abandoned:
            return {
                tag: "abandon",
                status: `@${user} This PR appears abandoned and will be closed soon ` +
                    "if there is no other activity from you.",
            };
        case InfoKind.MergeAuto: // No need to comment, just merge
        case InfoKind.Waiting:
            return undefined;
    }
}
function getTravisComment(
    travisResult: TravisResult, reviewPingList: ReadonlyArray<string>, user: string): Comment | undefined {
    switch (travisResult) {
        case TravisResult.Missing:
            return {
                tag: "where-is-travis",
                status: `@${user} - It appears Travis did not correctly run on this PR! ` +
                    "/cc @RyanCavanaugh to investigate and advise.",
            };

        case TravisResult.Pass:
            // Ping people if they reviewed in the past but now there's a passing CI build
            if (reviewPingList.length === 0) {
                return undefined;
            }
            const tag = hash(reviewPingList.join(","));
            return {
                tag: `reviewPing-${tag}`,
                // tslint:disable-next-line prefer-template
                status: `${reviewPingList.map(s => "@" + s).join(" ")} - Thanks for your review of this PR! ` +
                    "Can you please look at the new code and update your review status if appropriate?",
            };

        case TravisResult.Fail:
        case TravisResult.Unknown:
            return undefined;
    }
}

function hash(s: string): string {
    return crypto.createHash("md5").update(s).digest("hex");
}
