import crypto = require("crypto");

import { PrInfo } from "./pr-info";
import { ProjectColumn } from "./project";
import { TravisResult } from "./util/travis";

export function getProjectColumn(info: PrInfo): ProjectColumn | undefined {
    if (info.hasMergeConflict ||
        info.travisResult === TravisResult.Fail ||
        info.isChangesRequested) {
        return ProjectColumn.NeedsAuthorAttention;
    }

    if (info.isAbandoned || info.travisResult === TravisResult.Missing) {
        return ProjectColumn.Other;
    }

    if (info.isApprovedByOwner || info.authorIsOwner) {
        return ProjectColumn.CheckAndMerge;
    }

    if (info.isUnowned || info.isNewDefinition || info.isYSYL) {
        return ProjectColumn.Review;
    }

    if (info.isWaitingForReviews) {
        return ProjectColumn.WaitingForReviewers;
    }

    return ProjectColumn.Other;
}

export function getLabels(info: PrInfo): { readonly [label: string]: boolean } {
    const unmergeable = (info.travisResult === TravisResult.Fail) || info.hasMergeConflict || info.isChangesRequested;
    const mergeExpress = !unmergeable && (info.isApprovedByOwner || info.authorIsOwner);
    const mergeLgtm = !mergeExpress && info.isLGTM && !unmergeable;
    const mergeYsyl = !mergeExpress && !mergeLgtm && info.isYSYL && !unmergeable;
    const labels = {
        "Owner Approved": info.isApprovedByOwner,
        "Other Approved": info.isApprovedByOther,
        "Where is Travis?": info.travisResult === TravisResult.Missing,
        "Unowned": info.isUnowned && !info.authorIsOwner,
        "New Definition": info.isNewDefinition,
        "Popular package": info.touchesPopularPackage,
        "Awaiting reviewer feedback": !info.isUnowned && !info.isApprovedByOwner && info.travisResult !== TravisResult.Fail && !info.isChangesRequested,
        "Author is Owner": info.authorIsOwner,
        "The Travis CI build failed": info.travisResult === TravisResult.Fail,
        "Has Merge Conflict": info.hasMergeConflict,
        "Abandoned": info.isAbandoned,
        "Merge:Express": mergeExpress,
        "Merge:LGTM": mergeLgtm,
        "Merge:YSYL": mergeYsyl,
        "Revision Needed": info.isChangesRequested
    };
    return labels;
}

export interface Comment {
    readonly tag: string;
    readonly status: string;
}

export function getComments(info: PrInfo, user: string): ReadonlyArray<Comment> {
    const { reviewPingList, travisResult } = info;

    const comments: Comment[] = [];
    const greetingComment = getGreetingComment(info);
    comments.push(greetingComment);

    const mainComment = getMainComment(info, user);
    if (mainComment !== undefined) {
        comments.push(mainComment);
    }

    const travisComment = getTravisComment(travisResult, reviewPingList, user);
    if (travisComment !== undefined) {
        comments.push(travisComment);
    }

    return comments;
}

function getGreetingComment(info: PrInfo): Comment {
    let comment: string;
    
    if (info.isNewDefinition) {
        comment = `@${info.author} Thank you for submitting this PR!
        
Because this is a new definition, a DefinitelyTyped maintainer will be reviewing this PR in the next few days once the Travis CI build passes.
        
In the meantime, if the build fails or a merge conflict occurs, I'll let you know. Have a nice day!`;
    }
    else if (info.isUnowned) {
        if (info.authorIsOwner) {
            comment = `@${info.author} Thank you for submitting this PR!
        
Pull requests from definition owners are typically merged after quick review from a DefinitelyTyped maintainer once the CI passes.
                    
In the meantime, if the build fails or a merge conflict occurs, I'll let you know. Have a nice day!`;
        } else {
            comment = `@${info.author} Thank you for submitting this PR!

Because this PR doesn't have any code reviewers, a DefinitelyTyped maintainer will be reviewing it in the next few days once the Travis CI build passes.
        
In the meantime, if the build fails or a merge conflict occurs, I'll let you know. Have a nice day!`;
        }
    }
    else {
        const ownerList = Array.from(info.owners.values()).map(o => `@${o}`).join(' ');
        comment = `@${info.author} Thank you for submitting this PR!

🔔 ${ownerList} - please [review this PR](${info.reviewLink}) in the next few days. Be sure to explicitly select **\`Approve\`** or **\`Request Changes\`** in the GitHub UI so I know what's going on.

If no reviewer appears after a week, a DefinitelyTyped maintainer will review the PR instead.`;
    }

    return ({
        tag: "welcome",
        status: comment
    });
}

function getMainComment(info: PrInfo, user: string): Comment | undefined {
    if (info.isAbandoned) {
        return {
            tag: "abandon-sorry",
            status: `@${user} To keep things tidy, we have to close PRs that aren't mergeable but don't have activity from their author. No worries, though - please open a new PR if you'd like to continue with this change. Thank you!`
        };
    }
    if (info.isNearlyAbandoned) {
        return {
            tag: "abandon-warn",
            status: `@${user} I haven't seen anything from you in a while and this PR currently has problems that prevent it from being merged. The PR will be closed tomorrow if there aren't new commits to fix the issues.`
        };
    }
    if (info.travisResult === TravisResult.Fail) {
        return {
            tag: `complaint-${+info.lastCommitDate}`,
            status: `@${user} The Travis CI build failed! Please [review the logs for more information](${info.travisUrl}).\r\n\r\nOnce you've pushed the fixes, the build will automatically re-run. Thanks!`
        };
    }
    if (info.hasMergeConflict) {
        return {
            tag: "complaint",
            status: `@${user} Unfortunately, this pull request currently has a merge conflict 😥. Please update your PR branch to be up-to-date with respect to master. Have a nice day!`
        };
    }
    if (info.isChangesRequested) {
        return { tag: "complaint", status: `@${user} One or more reviewers has requested changes. Please address their comments. I'll be back once they sign off or you've pushed new commits or comments. Thank you!` };
    }
    if (info.isApprovedByOwner) {
        return {
            tag: "merge",
            status: "A definition owner has approved this PR ⭐️. A maintainer will merge this PR shortly. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for your contribution to DefinitelyTyped!",
        };
    }
    if (info.authorIsOwner) {
        return {
            tag: "merge",
            status: "Since you're a listed owner and the build passed, this PR is fast-tracked. A maintainer will merge shortly. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for your contribution to DefinitelyTyped!",
        };
    }
    if (info.isLGTM) {
        return {
            tag: "merge",
            status: "We've gotten sign-off from a reviewer 👏. A maintainer will soon review this PR and merge it if there are no issues. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for contributing to DefinitelyTyped!",
        };
    }
    if (info.isYSYL) {
        return {
            tag: "merge",
            status: "After 5 days, no one has reviewed the PR 😞. A maintainer will be reviewing the PR in the next few days and will either merge it or request revisions. Thank you for your patience!",
        };
    }

    return undefined;
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
                status: `🔔 ${reviewPingList.map(s => "@" + s).join(" ")} - Thanks for your review of this PR! ` +
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
