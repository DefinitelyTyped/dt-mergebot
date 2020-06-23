import * as Comments from "./comments";
import { PrInfo, ApprovalFlags, BotEnsureRemovedFromProject, BotNoPackages } from "./pr-info";
import { CIResult } from "./util/CIResult";
import { daysSince } from "./util/util";

type ColumnName =
    | "Other"
    | "Needs Maintainer Review"
    | "Waiting for Author to Merge"
    | "Needs Author Action"
    | "Recently Merged"
    | "Waiting for Code Reviews";

type LabelName =
    | "Has Merge Conflict"
    | "The CI failed"
    | "Revision needed"
    | "New Definition"
    | "Where is GH Actions?"
    | "Owner Approved"
    | "Other Approved"
    | "Maintainer Approved"
    | "Merge:Auto"
    | "Merge:LGTM"
    | "Merge:YSYL"
    | "Popular package"
    | "Critical package"
    | "Edits Infrastructure"
    | "Edits multiple packages"
    | "Author is Owner"
    | "Untested Change"
    | "Config Edit";

export interface Actions {
    pr_number: number;
    targetColumn?: ColumnName;
    labels: { [L in LabelName]?: boolean };
    responseComments: Comments.Comment[];
    shouldClose: boolean;
    shouldMerge: boolean;
    shouldUpdateLabels: boolean;
    shouldUpdateProjectColumn: boolean;
    shouldRemoveFromActiveColumns: boolean;
    isReadyForAutoMerge: boolean;
}

function createDefaultActions(prNumber: number): Actions {
    return {
        pr_number: prNumber,
        targetColumn: "Other",
        labels: {
            "Has Merge Conflict": false,
            "The CI failed": false,
            "Revision needed": false,
            "New Definition": false,
            "Where is GH Actions?": false,
            "Owner Approved": false,
            "Other Approved": false,
            "Maintainer Approved": false,
            "Merge:LGTM": false,
            "Merge:YSYL": false,
            "Popular package": false,
            "Critical package": false,
            "Edits Infrastructure": false,
            "Edits multiple packages": false,
            "Author is Owner": false,
            "Merge:Auto": false,
            "Untested Change": false,
            "Config Edit": false
        },
        responseComments: [],
        shouldClose: false,
        shouldMerge: false,
        shouldUpdateLabels: true,
        shouldUpdateProjectColumn: true,
        shouldRemoveFromActiveColumns: false,
        isReadyForAutoMerge: false
    };
}

function createEmptyActions(prNumber: number): Actions {
    return {
        pr_number: prNumber,
        labels: {},
        responseComments: [],
        shouldClose: false,
        shouldMerge: false,
        shouldUpdateLabels: false,
        shouldUpdateProjectColumn: false,
        shouldRemoveFromActiveColumns: false,
        isReadyForAutoMerge: false
    };
}

const uriForTestingEditedPackages = "https://github.com/DefinitelyTyped/DefinitelyTyped#editing-tests-on-an-existing-package";
const uriForTestingNewPackages = "https://github.com/DefinitelyTyped/DefinitelyTyped#testing";

export function process(info: PrInfo | BotEnsureRemovedFromProject | BotNoPackages): Actions {
    if (info.type === "remove") {
        return {
            ...createEmptyActions(info.pr_number),
            shouldRemoveFromActiveColumns: true,
        };
    }

    if (info.type === "no_packages") {
        return {
            ...createEmptyActions(info.pr_number),
            targetColumn: "Needs Maintainer Review",
            shouldUpdateProjectColumn: true
        };
    }

    const context = createDefaultActions(info.pr_number);

    const now = new Date(info.now);

    // Some step should override this
    context.targetColumn = "Other";

    // General labelling and housekeeping
    context.labels["Critical package"] = info.popularityLevel === "Critical";
    context.labels["Popular package"] = info.popularityLevel === "Popular";
    context.labels["Other Approved"] = !!(info.approvalFlags & ApprovalFlags.Other);
    context.labels["Owner Approved"] = !!(info.approvalFlags & ApprovalFlags.Owner);
    context.labels["Maintainer Approved"] = !!(info.approvalFlags & ApprovalFlags.Maintainer);
    context.labels["New Definition"] = info.anyPackageIsNew;
    context.labels["Author is Owner"] = info.authorIsOwner;
    context.labels["Merge:Auto"] = canBeMergedNow(info);
    context.labels["Config Edit"] = !info.anyPackageIsNew && info.dangerLevel === "ScopedAndConfiguration";
    context.isReadyForAutoMerge = canBeMergedNow(info);
    context.labels["Untested Change"] = info.dangerLevel === "ScopedAndUntested";

    // Update intro comment
    context.responseComments.push({
        tag: "welcome",
        status: createWelcomeComment(info)
    });

    // Ping reviewers when needed
    const otherOwners = info.owners.filter(o => info.author.toLowerCase() !== o.toLowerCase());
    if (otherOwners.length && !info.isChangesRequested && !(info.approvalFlags & (ApprovalFlags.Owner | ApprovalFlags.Maintainer))) {
        const tooManyOwners = info.owners.length > 50;
        if (tooManyOwners) {
            context.responseComments.push(Comments.PingReviewersTooMany(otherOwners));
        } else {
            context.responseComments.push(Comments.PingReviewers(otherOwners, info.reviewLink));
        }
    }

    // Needs author attention (bad CI, merge conflicts)
    const failedCI = info.ciResult === CIResult.Fail;
    if (failedCI || info.hasMergeConflict || info.isChangesRequested) {
        context.targetColumn = "Needs Author Action";

        if (info.hasMergeConflict) {
            context.labels["Has Merge Conflict"] = true;
            context.responseComments.push(Comments.MergeConflicted(info.headCommitAbbrOid, info.author));
        }
        if (failedCI) {
            context.labels["The CI failed"] = true;
            context.responseComments.push(Comments.CIFailed(info.headCommitAbbrOid, info.author, info.ciUrl!));
        }
        if (info.isChangesRequested) {
            context.labels["Revision needed"] = true;
            context.responseComments.push(Comments.ChangesRequest(info.headCommitAbbrOid, info.author));
        }

        // Could be abandoned
        switch (getStaleness(info)) {
            case Staleness.NearlyAbandoned:
                context.responseComments.push(Comments.NearlyAbandoned(info.author));
                break;
            case Staleness.Abandoned:
                context.responseComments.push(Comments.SorryAbandoned(info.author));
                context.shouldClose = true;
                context.shouldRemoveFromActiveColumns = true;
                break;
        }
    }
    // CI is running; default column is Waiting for Reviewers
    else if (info.ciResult === CIResult.Pending) {
        context.targetColumn = "Waiting for Code Reviews";
    }
    // CI is missing
    else if (info.ciResult === CIResult.Missing) {
        context.labels["Where is GH Actions?"] = true;
    }
    // CI is green
    else if (info.ciResult === CIResult.Pass) {
        const isAutoMergeable = canBeMergedNow(info);

        if (isAutoMergeable) {
            if (info.mergeIsRequested) {
                context.shouldMerge = true;
                context.targetColumn = "Recently Merged";
            } else {
                context.responseComments.push(Comments.AskForAutoMergePermission(info.author));
                context.targetColumn = "Waiting for Author to Merge";
            }
        } else {
            // Give 4 days for PRs with other owners
            const fourDays = 4 * 24 * 60 * 60 * 1000;
            if (!info.anyPackageIsNew && info.lastCommitDate.valueOf() + fourDays > now.valueOf()) {
                context.targetColumn = projectBoardForReviewWithWithLeastAccess(info);
            } else {
                context.targetColumn = "Needs Maintainer Review";
            }
        }

        // Ping stale reviewers if any
        if (info.reviewersWithStaleReviews.length) {
            const mostRecentReview = [...info.reviewersWithStaleReviews].sort((l, r) => l.date.localeCompare(r.date))[0];
            const reviewersDeDuped = [...new Set(info.reviewersWithStaleReviews.map(r => r.reviewer))];
            context.responseComments.push(Comments.PingStaleReviewer(mostRecentReview.reviewedAbbrOid, reviewersDeDuped));
        }
    }

    // This bot is faster than CI in coming back to give a response, and so the bot starts flipping between
    // a 'where is CI'-ish state and a 'got CI deets' state. To work around this, we wait a 
    // minute since the last timeline push action before label/project states can be updated

    const oneMinute = 60 * 1000;
    const tooEarlyForLabelsOrProjects = info.lastCommitDate.valueOf() + oneMinute < now.valueOf();
    context.shouldUpdateLabels = tooEarlyForLabelsOrProjects;
    context.shouldUpdateProjectColumn = tooEarlyForLabelsOrProjects;

    return context;
}

function canBeMergedNow(info: PrInfo): boolean {
    if (info.ciResult !== CIResult.Pass) {
        return false;
    }
    if (info.hasMergeConflict) {
        return false;
    }

    return hasFinalApproval(info).approved;
}

type PotentialReviewers = "DT maintainers" | "type definition owners or DT maintainers" | "type definition owners, DT maintainers or others"

function hasFinalApproval(info: PrInfo) {
    const tooManyReviewers = info.owners.length > 50;
    let approved = false;
    let requiredApprovalBy: PotentialReviewers = "DT maintainers";

    if (info.dangerLevel === "ScopedAndTested" && !tooManyReviewers) {
        if (info.popularityLevel === "Well-liked by everyone") {
            approved = !!(info.approvalFlags & (ApprovalFlags.Maintainer | ApprovalFlags.Owner | ApprovalFlags.Other));
            requiredApprovalBy = "type definition owners, DT maintainers or others";
        } else if (info.popularityLevel === "Popular") {
            approved = !!(info.approvalFlags & (ApprovalFlags.Maintainer | ApprovalFlags.Owner));
            requiredApprovalBy = "type definition owners or DT maintainers";
        } else if (info.popularityLevel === "Critical") {
            approved = !!(info.approvalFlags & (ApprovalFlags.Maintainer));
            requiredApprovalBy = "DT maintainers";
        } else {
            throw new Error("Unknown popularity level " + info.popularityLevel);
        }
    } else {
        approved = !!(info.approvalFlags & (ApprovalFlags.Maintainer));
        requiredApprovalBy = "DT maintainers";
    }

    return {
        approved,
        requiredApprovalBy
    };
}

/** E.g. let people review, but fall back to the DT maintainers based on the access rights above */
function projectBoardForReviewWithWithLeastAccess(info: PrInfo):  Actions["targetColumn"] {
    const approvers = hasFinalApproval(info)
    if (approvers.requiredApprovalBy === "DT maintainers") {
        return "Needs Maintainer Review";
    } else {
        return "Waiting for Code Reviews";
    }
}

const enum Staleness {
    Fresh,
    NearlyAbandoned,
    Abandoned,
}

function getStaleness(info: PrInfo): Staleness {
    const daysSinceLastHumanComment = daysSince(info.lastCommentDate, info.now);
    const daysSinceLastPush = daysSince(info.lastCommitDate, info.now);
    const daysSinceReopened = info.reopenedDate ? daysSince(info.reopenedDate, info.now) : Infinity;
    const daysSinceLastReview = info.lastReviewDate ? daysSince(info.lastReviewDate, info.now) : Infinity;
    const daysSinceLastActivity = Math.min(daysSinceLastPush, daysSinceLastHumanComment, daysSinceReopened, daysSinceLastReview);

    if (daysSinceLastActivity >= 30) return Staleness.Abandoned;
    if (daysSinceLastActivity >= 28) return Staleness.NearlyAbandoned;
    return Staleness.Fresh;
}

function createWelcomeComment(info: PrInfo) {
    const otherOwners = info.owners.filter(a => a.toLowerCase() !== info.author.toLowerCase());
    const testsLink = info.anyPackageIsNew ? uriForTestingNewPackages : uriForTestingEditedPackages;

    const specialWelcome = info.isFirstContribution ? ` I see this is your first time submitting to DefinitelyTyped 👋 - keep an eye on this comment as I'll be updating it with information as things progress.` : "";
    const introCommentLines: string[] = [];
    introCommentLines.push(`@${info.author} Thank you for submitting this PR! ${specialWelcome}`);
    introCommentLines.push(``);

    // Lets the author know who needs to review this
    let reviewerAdvisory: string | undefined;
    // Some kind of extra warning
    let dangerComment: string | undefined;
    if (info.anyPackageIsNew) {
        const links = info.packages.map(p => `- [${p} on npm](https://www.npmjs.com/package/${p})\n - [${p} on unpkg](https://unpkg.com/browse/${p}@latest//)`).join("\n");
        reviewerAdvisory = `This PR adds a new definition, so it needs to be reviewed by a DT maintainer before it can be merged.\n\n${links}`;
    } else if (info.popularityLevel === "Critical") {
        reviewerAdvisory = "Because this is a widely-used package, a DT maintainer will need to review it before it can be merged.";
    } else if (info.dangerLevel === "ScopedAndTested") {
        reviewerAdvisory = "Because you edited one package and updated the tests (👏), I can help you merge this PR once someone else signs off on it.";
    } else if (otherOwners.length === 0) {
        reviewerAdvisory = "There aren't any other owners of this package, so a DT maintainer will review it.";
    } else if (info.dangerLevel === "MultiplePackagesEdited") {
        reviewerAdvisory = "Because this PR edits multiple packages, it can be merged once it's reviewed by a DT maintainer.";
    } else if (info.dangerLevel === "ScopedAndConfiguration") {
        reviewerAdvisory = "Because this PR edits the configuration file, it can be merged once it's reviewed by a DT maintainer.";
    } else {
        reviewerAdvisory = "This PR can be merged once it's reviewed by a DT maintainer.";
    }

    if (info.dangerLevel === "ScopedAndUntested") {
        dangerComment = `This PR doesn't modify any tests, so it's hard to know what's being fixed, and your changes might regress in the future. Have you considered [adding tests](${testsLink}) to cover the change you're making? Including tests allows this PR to be merged by yourself and the owners of this module. This can potentially save days of time for you.`;
    } else if (info.dangerLevel === "Infrastructure") {
        dangerComment = "This PR touches some part of DefinitelyTyped infrastructure, so a DT maintainer will need to review it. This is rare - did you mean to do this?";
    }

    if (dangerComment !== undefined) {
        introCommentLines.push(" " + dangerComment);
    }

    const waitingOnThePRAuthorToMerge = !info.hasMergeConflict && info.ciResult === CIResult.Pass && info.dangerLevel === "ScopedAndTested" && hasFinalApproval(info).approved;

    introCommentLines.push(``);
    introCommentLines.push(`## Code Reviews`);
    introCommentLines.push(``);
    introCommentLines.push(reviewerAdvisory);
    introCommentLines.push(``);
    introCommentLines.push(`## Status`);
    introCommentLines.push(``);
    introCommentLines.push(` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);

    const expectedResults = info.ciResult === CIResult.Pending ? "finished" : "passed";
    introCommentLines.push(` * ${emoji(info.ciResult === CIResult.Pass)} Continuous integration tests have ${expectedResults}`);

    const approval = hasFinalApproval(info)
    if (info.anyPackageIsNew) {
        introCommentLines.push(` * ${emoji(approval.approved)} Only a DT maintainer can merge changes when there are new packages added`);
    } else if (info.dangerLevel === "ScopedAndTested") {
        introCommentLines.push(` * ${emoji(approval.approved)} Most recent commit is approved by ${approval.requiredApprovalBy}`);
    } else if (otherOwners.length === 0) {
        introCommentLines.push(` * ${emoji(approval.approved)} A DT maintainer can merge changes when there are no other reviewers`);
    } else if (info.files.find(f => f.kind === "infrastructure")) {
        const infraFiles = info.files.filter(f => f.kind === "infrastructure")
        const links = infraFiles.map(f => `[${f.filePath}](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/${info.headCommitOid}/${f.filePath})`)
        introCommentLines.push(` * ${emoji(approval.approved)} A DT maintainer needs to merge changes which affect DT infrastructure (${links.join(", ")})`);
    } else if (info.dangerLevel === "ScopedAndConfiguration") {
        introCommentLines.push(` * ${emoji(approval.approved)} A DT maintainer needs to merge changes which affect module config files`);
    } else {
        introCommentLines.push(` * ${emoji(approval.approved)} Only a DT maintainer can merge changes [without tests](${testsLink})`);
    }

    introCommentLines.push(``);
    if (!waitingOnThePRAuthorToMerge) {
        introCommentLines.push(`Once every item on this list is checked, I'll ask you for permission to merge and publish the changes.`);
    } else {
        introCommentLines.push(`All of the items on the list are green. **To merge, you need to post a comment including the string "Ready to merge"** to bring in your changes.`);
    }

    // Remove the 'now' attribute because otherwise the comment would need editing every time
    // and that's spammy.
    const shallowPresentationInfoCopy = { ...info };
    shallowPresentationInfoCopy.now = "-";

    introCommentLines.push(``);
    introCommentLines.push(`----------------------`);
    introCommentLines.push(`<details><summary>Diagnostic Information: What the bot saw about this PR</summary>\n\n${'```json\n' + JSON.stringify(shallowPresentationInfoCopy, undefined, 2) + '\n```'}\n\n</details>`);

    return introCommentLines.join("\n");

    function emoji(n: boolean) {
        return n ? "✅" : "❌";
    }
}
