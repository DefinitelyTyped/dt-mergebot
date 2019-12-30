import * as Comments from "./comments";
import { PrInfo, ApprovalFlags } from "./pr-info";
import { TravisResult } from "./util/travis";

export type Context = typeof DefaultContext;
export const DefaultContext = {
    targetColumn: "Other",
    labels: {
        "Has Merge Conflict": false,
        "The Travis CI build failed": false,
        "Revision needed": false,
        "New Definition": false,
        "Where is Travis?": false,
        "Owner Approved": false,
        "Other Approved": false,
        "Maintainer Approved": false,
        "Merge:LGTM": false,
        "Merge:YSYL": false,
        "Popular Package": false,
        "Critical Package": false,
        "Edits Infrastructure": false,
        "Edits multiple packages": false,
        "Author is Owner": false
    },
    responseComments: [] as Comments.Comment[],
    shouldClose: false,
    shouldMerge: false
};

export function process(info: PrInfo): Context {
    const context = { ...DefaultContext };

    // Some step should override this
    context.targetColumn = "Other";

    // General labelling and housekeeping
    context.labels["Critical Package"] = info.popularityLevel === "Critical";
    context.labels["Popular Package"] = info.popularityLevel === "Popular";
    context.labels["Other Approved"] = !!(info.approvalFlags & ApprovalFlags.Other);
    context.labels["Owner Approved"] = !!(info.approvalFlags & ApprovalFlags.Owner);
    context.labels["Maintainer Approved"] = !!(info.approvalFlags & ApprovalFlags.Maintainer);
    context.labels["New Definition"] = info.anyPackageIsNew;
    context.labels["Author is Owner"] = info.authorIsOwner;

    // Update intro comment
    context.responseComments.push({
        tag: "welcome",
        status: createWelcomeComment(info)
    });

    // Needs author attention (bad CI, merge conflicts)
    const failedCI = info.travisResult === TravisResult.Fail;
    if (failedCI || info.hasMergeConflict || info.isChangesRequested) {
        context.targetColumn = "Needs Author Attention";

        if (info.hasMergeConflict) {
            context.labels["Has Merge Conflict"] = true;
            context.responseComments.push(Comments.MergeConflicted(info.headCommitOid, info.author));
        }
        if (failedCI) {
            context.labels["The Travis CI build failed"] = true;
            context.responseComments.push(Comments.TravisFailed(info.headCommitOid, info.author, info.travisUrl!));
        }
        if (info.isChangesRequested) {
            context.labels["Revision needed"] = true;
            context.responseComments.push(Comments.ChangesRequest(info.headCommitOid, info.author));
        }

        // Could be abandoned
        if (daysStaleBetween(5, 7)(info)) {
            context.responseComments.push(Comments.NearlyAbandoned(info.headCommitAbbrOid));
        }
        if (daysStaleAtLeast(7)(info)) {
            context.responseComments.push(Comments.SorryAbandoned(info.headCommitAbbrOid));
            context.shouldClose = true;
        }
    }

    // CI is running; default column is Waiting for Reviewers
    if (info.travisResult === TravisResult.Pending) {
        context.targetColumn = "Waiting for Reviewers";
    }

    // CI is missing
    if (info.travisResult === TravisResult.Missing) {
        context.labels["Where is Travis?"] = true;
    }

    // CI is green
    if (info.travisResult === TravisResult.Pass) {
        const isAutoMergeable = canBeMergedNow(info);

        if (isAutoMergeable) {
            if (info.mergeIsRequested) {
                context.shouldMerge = true;
            } else {
                context.responseComments.push(Comments.AskForAutoMergePermission(info.author))
            }
        }

        // Ping stale reviewers if any
        for (const staleReviewer of info.reviewersWithStaleReviews) {
            context.responseComments.push(Comments.PingStaleReviewer(staleReviewer.reviewedAbbrOid, staleReviewer.reviewer))
        }
    }

    return context;
}

function canBeMergedNow(info: PrInfo): boolean {
    if (info.travisResult !== TravisResult.Pass) {
        return false;
    }
    if (info.hasMergeConflict) {
        return false;
    }

    return hasFinalApproval(info);
}

function hasFinalApproval(info: PrInfo): boolean {
    if (info.dangerLevel === "ScopedAndTested") {
        if (info.popularityLevel === "Well-liked by everyone") {
            return !!(info.approvalFlags & (ApprovalFlags.Maintainer | ApprovalFlags.Owner | ApprovalFlags.Other));
        } else if (info.popularityLevel === "Popular") {
            return !!(info.approvalFlags & (ApprovalFlags.Maintainer | ApprovalFlags.Owner));
        } else if (info.popularityLevel === "Critical") {
            return !!(info.approvalFlags & (ApprovalFlags.Maintainer));
        } else {
            throw new Error("Unknown popularity level " + info.popularityLevel);
        }
    } else {
        return !!(info.approvalFlags & (ApprovalFlags.Maintainer));
    }
}

function needsMaintainerApproval(info: PrInfo) {
    return info.dangerLevel !== "ScopedAndTested";
}

function daysStaleAtLeast(days: number) {
    return (info: PrInfo) => info.stalenessInDays >= days;
}

function daysStaleBetween(lowerBoundInclusive: number, upperBoundExclusive: number) {
    return (info: PrInfo) => (info.stalenessInDays >= lowerBoundInclusive && info.stalenessInDays < upperBoundExclusive);
}

function createWelcomeComment(info: PrInfo) {
    const signoff = needsMaintainerApproval(info) ? "a maintainer" : "an owner or maintainer";
    const owners = info.owners.filter(a => a.toLowerCase() !== info.author.toLowerCase());

    const introCommentLines: string[] = [];
    introCommentLines.push(`@${info.author} Thank you for submitting this PR!`)
    if (info.isFirstContribution) {
        introCommentLines.push(`I see this is your first time submitting to DefinitelyTyped - keep an eye on this comment as I'll be updating it with information as things progress.`);
    }
    introCommentLines.push(``);

    const dangerComments = {
        "ScopedAndTested": "This PR edits exactly one package and also made updates to the test file, so it's one of my favorites 🌟. We'll try to merge it as quickly as possible.",
        "ScopedAndUntested": "This PR doesn't update any tests, so it may not be clear what's being fixed. Please consider adding some test code that verifies your change. Thanks!",
        "ScopedAndConfiguration": "This PR edits the config file of a package, so a maintainer will need to review it.",
        "NewDefinition": "This PR adds a new definition, so a maintainer will need to review it.",
        "MultiplePackagesEdited": "This PR updates multiple packages, so a maintainer will need to review it.",
        "Infrastructure": "This PR touches some part of DefinitelyTyped infrastructure, so a maintainer will need to review it. This is rare - did you mean to do this?"
    } as const;
    introCommentLines.push(dangerComments[info.dangerLevel]);

    introCommentLines.push(``);
    introCommentLines.push(`----------------------`);
    introCommentLines.push(``);
    introCommentLines.push(`## Code Reviews`)
    introCommentLines.push(``);
    if (owners.length === 0) {
        if (info.anyPackageIsNew) {
            introCommentLines.push(`This is a new package, so I don't have anyone specific to ask for code reviews. I always like seeing reviews from community members, though!`);
        } else {
            introCommentLines.push(`I didn't see any other owners to ask for code reviews. A maintainer will review your PR when possible.`);
        }
    } else {
        introCommentLines.push(`🔔 ${owners.map(n => `@${n}`).join(" ")} - please [review this PR](${info.reviewLink}) in the next few days. Be sure to explicitly select **\`Approve\`** or **\`Request Changes\`** in the GitHub UI so I know what's going on.`);
    }

    introCommentLines.push(``);
    introCommentLines.push(`----------------------`);
    introCommentLines.push(``)
    introCommentLines.push(`## Status`)
    introCommentLines.push(``);
    introCommentLines.push(` * ${emoji(info.travisResult === TravisResult.Pass)} Continuous integration tests have passed`);
    introCommentLines.push(` * ${emoji(hasFinalApproval(info))} Most recent commit is approved by ${signoff}`);
    introCommentLines.push(` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);
    introCommentLines.push(` * ${emoji(info.mergeIsRequested)} You've commented "Ready to merge"`);
    introCommentLines.push(``);
    introCommentLines.push(`Once every item on this list is checked, I'll merge this PR automatically!`)
    introCommentLines.push(``);
    introCommentLines.push(`----------------------`);
    introCommentLines.push(`<details><summary>Diagnostic Information: What the bot saw about this PR</summary>\n\n${'```\n' + JSON.stringify(info, undefined, 2) + '\n```'}\n\n</details>`);

    return introCommentLines.join("\n");

    function emoji(n: boolean) {
        return n ? '✅' : '❌';
    }
}
