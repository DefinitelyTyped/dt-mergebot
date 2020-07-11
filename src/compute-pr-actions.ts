import * as Comments from "./comments";
import { PrInfo, ApprovalFlags, BotEnsureRemovedFromProject, BotNoPackages } from "./pr-info";
import { CIResult } from "./util/CIResult";
import { daysSince } from "./util/util";

type ColumnName =
    | "Needs Maintainer Action"
    | "Needs Maintainer Review"
    | "Other"
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
    | "No Other Owners"
    | "Too Many Owners"
    | "Untested Change"
    | "Config Edit"
    | "Abandoned";

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
            "No Other Owners": false,
            "Too Many Owners": false,
            "Merge:Auto": false,
            "Untested Change": false,
            "Config Edit": false,
            "Abandoned": false
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
            targetColumn: "Needs Maintainer Action",
            shouldUpdateProjectColumn: true
        };
    }

    const context = createDefaultActions(info.pr_number);

    const now = new Date(info.now);

    // Collect some additional info
    const failedCI = info.ciResult === CIResult.Fail;
    const needsAuthorAttention = failedCI || info.hasMergeConflict || info.isChangesRequested;
    const staleness = getStaleness(info, needsAuthorAttention);
    const otherOwners = info.owners.filter(o => info.author.toLowerCase() !== o.toLowerCase());

    // General labelling and housekeeping
    context.labels["Critical package"] = info.popularityLevel === "Critical";
    context.labels["Popular package"] = info.popularityLevel === "Popular";
    context.labels["Other Approved"] = !!(info.approvalFlags & ApprovalFlags.Other);
    context.labels["Owner Approved"] = !!(info.approvalFlags & ApprovalFlags.Owner);
    context.labels["Maintainer Approved"] = !!(info.approvalFlags & ApprovalFlags.Maintainer);
    context.labels["New Definition"] = info.anyPackageIsNew;
    context.labels["Edits Infrastructure"] = info.dangerLevel === "Infrastructure";
    context.labels["Edits multiple packages"] = info.dangerLevel === "MultiplePackagesEdited";
    context.labels["Author is Owner"] = info.authorIsOwner;
    context.labels["No Other Owners"] = !info.anyPackageIsNew && otherOwners.length === 0;
    context.labels["Too Many Owners"] = tooManyOwners(info);
    context.labels["Merge:Auto"] = canBeMergedNow(info);
    context.labels["Config Edit"] = !info.anyPackageIsNew && info.dangerLevel === "ScopedAndConfiguration";
    context.isReadyForAutoMerge = canBeMergedNow(info);
    context.labels["Untested Change"] = info.dangerLevel === "ScopedAndUntested";
    context.labels["Merge:YSYL"] = staleness === Staleness.YSYL;
    context.labels["Abandoned"] = staleness === Staleness.Abandoned;

    // Update intro comment
    context.responseComments.push({
        tag: "welcome",
        status: createWelcomeComment(info, staleness)
    });

    // Ping reviewers when needed
    if (otherOwners.length > 0 && !info.isChangesRequested && !(info.approvalFlags & (ApprovalFlags.Owner | ApprovalFlags.Maintainer))) {
        if (tooManyOwners(info)) {
            context.responseComments.push(Comments.PingReviewersTooMany(otherOwners));
        } else {
            context.responseComments.push(Comments.PingReviewers(otherOwners, info.reviewLink));
        }
    }

    // Some step should override this
    context.targetColumn = "Other";

    // Needs author attention (bad CI, merge conflicts)
    if (needsAuthorAttention) {
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
        switch (staleness) {
            case Staleness.NearlyYSYL: case Staleness.YSYL:
                throw new Error("Internal Error: unexpected Staleness.YSYL");
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
    else if (staleness === Staleness.Abandoned) {
        throw new Error("Internal Error: unexpected Staleness.Abandoned");
    }
    // Stale & doesn't need author attention => move to maintainer queue
    else if (staleness === Staleness.YSYL) {
        context.targetColumn = "Needs Maintainer Action";
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
        if (!canBeMergedNow(info)) {
            context.targetColumn = projectBoardForReviewWithLeastAccess(info);
        }
        else if (info.mergeIsRequested) {
            context.shouldMerge = true;
            context.targetColumn = "Recently Merged";
        }
        else {
            context.responseComments.push(Comments.AskForAutoMergePermission(info.author));
            context.targetColumn = "Waiting for Author to Merge";
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
    const tooEarlyForLabelsOrProjects = info.lastPushDate.valueOf() + oneMinute < now.valueOf();
    context.shouldUpdateLabels = tooEarlyForLabelsOrProjects;
    context.shouldUpdateProjectColumn = tooEarlyForLabelsOrProjects;

    return context;
}

function tooManyOwners(info: PrInfo): boolean {
    return info.owners.length > 50;
}

function canBeMergedNow(info: PrInfo): boolean {
    return info.ciResult === CIResult.Pass
        && !info.hasMergeConflict
        && hasFinalApproval(info).approved;
}

type ApproverKinds = "maintainers" | "owners" | "others";
function hasFinalApproval(info: PrInfo) {
    const approvalFor = (who: ApproverKinds) => ({
        approved: !!(info.approvalFlags &
                     (who === "others" ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner | ApprovalFlags.Other)
                      : who === "owners" || info.maintainerBlessed ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner)
                      : (ApprovalFlags.Maintainer))),
        requiredApprovalBy: (who === "others" ? "type definition owners, DT maintainers or others"
                             : who === "owners" || info.maintainerBlessed ? "type definition owners or DT maintainers"
                             : "DT maintainers")
    });
    if (info.dangerLevel !== "ScopedAndTested" || tooManyOwners(info)) return approvalFor("maintainers");
    if (info.popularityLevel === "Well-liked by everyone") return approvalFor("others");
    if (info.popularityLevel === "Popular") return approvalFor("owners");
    if (info.popularityLevel === "Critical") return approvalFor("maintainers");
    throw new Error("Unknown popularity level " + info.popularityLevel);
}

/** E.g. let people review, but fall back to the DT maintainers based on the access rights above */
function projectBoardForReviewWithLeastAccess(info: PrInfo):  Actions["targetColumn"] {
    return hasFinalApproval(info).requiredApprovalBy === "DT maintainers"
        ? "Needs Maintainer Review"
        : "Waiting for Code Reviews";
}

const enum Staleness {
    Fresh,
    PayAttention,
    NearlyYSYL,
    YSYL,
    NearlyAbandoned,
    Abandoned,
}

function getStaleness(info: PrInfo, needsAuthorAttention: boolean) {
    return needsAuthorAttention
        ? (info.stalenessInDays <= 6 ? Staleness.Fresh
           : info.stalenessInDays <= 22 ? Staleness.PayAttention
           : info.stalenessInDays <= 30 ? Staleness.NearlyAbandoned
           : Staleness.Abandoned)
        : (info.stalenessInDays <= 2 ? Staleness.Fresh
           : info.stalenessInDays <= 4 ? Staleness.PayAttention
           : info.stalenessInDays <= 8 ? Staleness.NearlyYSYL
           : Staleness.YSYL);
}

function createWelcomeComment(info: PrInfo, staleness: Staleness) {
    let content: string = "";
    function display(...lines: string[]) {
        lines.forEach(line => content += line + "\n");
    }

    const otherOwners = info.owners.filter(a => a.toLowerCase() !== info.author.toLowerCase());
    const testsLink = info.anyPackageIsNew ? uriForTestingNewPackages : uriForTestingEditedPackages;

    const specialWelcome = !info.isFirstContribution ? `` :
        ` I see this is your first time submitting to DefinitelyTyped 👋 — I'm the local bot who will help you through the process of getting things through.`;
    display(`@${info.author} Thank you for submitting this PR!${specialWelcome}`,
            ``,
            `***This is a live comment which I will keep updated.***`,
            ``);

    // Lets the author know who needs to review this
    let reviewerAdvisory: string | undefined;
    // Some kind of extra warning
    let dangerComment: string | undefined;
    if (info.anyPackageIsNew) {
        const links = info.packages.map(p => `- [${p} on npm](https://www.npmjs.com/package/${p})\n- [${p} on unpkg](https://unpkg.com/browse/${p}@latest//)`).join("\n");
        reviewerAdvisory = `This PR adds a new definition, so it needs to be reviewed by a DT maintainer before it can be merged.\n\n${links}`;
    } else if (info.popularityLevel === "Critical" && !info.maintainerBlessed) {
        reviewerAdvisory = "Because this is a widely-used package, a DT maintainer will need to review it before it can be merged.";
    } else if (info.dangerLevel === "ScopedAndTested") {
        reviewerAdvisory = "Because you edited one package and updated the tests (👏), I can help you merge this PR once someone else signs off on it.";
    } else if (otherOwners.length === 0 && !info.maintainerBlessed) {
        reviewerAdvisory = "There aren't any other owners of this package, so a DT maintainer will review it.";
    } else if (info.dangerLevel === "MultiplePackagesEdited" && !info.maintainerBlessed) {
        reviewerAdvisory = "Because this PR edits multiple packages, it can be merged once it's reviewed by a DT maintainer.";
    } else if (info.dangerLevel === "ScopedAndConfiguration" && !info.maintainerBlessed) {
        reviewerAdvisory = "Because this PR edits the configuration file, it can be merged once it's reviewed by a DT maintainer.";
    } else if (!info.maintainerBlessed) {
        reviewerAdvisory = "This PR can be merged once it's reviewed by a DT maintainer.";
    } else {
        reviewerAdvisory = "This PR can be merged once it's reviewed.";
    }

    if (info.dangerLevel === "ScopedAndUntested") {
        dangerComment = `This PR doesn't modify any tests, so it's hard to know what's being fixed, and your changes might regress in the future. Have you considered [adding tests](${testsLink}) to cover the change you're making? Including tests allows this PR to be merged by yourself and the owners of this module. This can potentially save days of time for you.`;
    } else if (info.dangerLevel === "Infrastructure") {
        dangerComment = "This PR touches some part of DefinitelyTyped infrastructure, so a DT maintainer will need to review it. This is rare — did you mean to do this?";
    }

    if (dangerComment !== undefined) {
        display(" " + dangerComment);
    }

    const approval = hasFinalApproval(info);
    const waitingOnThePRAuthorToMerge =
        !info.hasMergeConflict
        && info.ciResult === CIResult.Pass
        && (info.dangerLevel === "ScopedAndTested" || info.maintainerBlessed)
        && approval.approved;

    display(``,
            `## Code Reviews`,
            ``,
            reviewerAdvisory,
            ``,
            `## Status`,
            ``,
            ` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);

    const expectedResults = info.ciResult === CIResult.Pending ? "finished" : "passed";
    display(` * ${emoji(info.ciResult === CIResult.Pass)} Continuous integration tests have ${expectedResults}`);

    if (info.anyPackageIsNew) {
        display(` * ${emoji(approval.approved)} Only a DT maintainer can approve changes when there are new packages added`);
    } else if (info.dangerLevel === "Infrastructure") {
        const infraFiles = info.files.filter(f => f.kind === "infrastructure")
        const links = infraFiles.map(f => `[\`${f.path}\`](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/${info.headCommitOid}/${f.path})`);
        display(` * ${emoji(approval.approved)} A DT maintainer needs to approve changes which affect DT infrastructure (${links.join(", ")})`);
    } else if (info.dangerLevel === "ScopedAndTested") {
        display(` * ${emoji(approval.approved)} Most recent commit is approved by ${approval.requiredApprovalBy}`);
    } else if (otherOwners.length === 0) {
        display(` * ${emoji(approval.approved)} A DT maintainer can merge changes when there are no other reviewers`);
    } else if (info.maintainerBlessed) {
        display(` * ${emoji(approval.approved)} Most recent commit is approved by ${approval.requiredApprovalBy}`);
    } else if (info.dangerLevel === "ScopedAndConfiguration") {
        display(` * ${emoji(approval.approved)} A DT maintainer needs to approve changes which affect module config files`);
    } else {
        display(` * ${emoji(approval.approved)} Only a DT maintainer can approve changes [without tests](${testsLink})`);
    }

    display(``);
    if (!waitingOnThePRAuthorToMerge) {
        display(`Once every item on this list is checked, I'll ask you for permission to merge and publish the changes.`);
    } else {
        display(`All of the items on the list are green. **To merge, you need to post a comment including the string "Ready to merge"** to bring in your changes.`);
    }

    if (staleness !== Staleness.Fresh) {
        display(``,
                `## Inactive`,
                ``,
                `This PR has been inactive for ${info.stalenessInDays} days${
                  staleness === Staleness.NearlyAbandoned ? " — it is considered nearly abandoned!"
                  : staleness === Staleness.NearlyYSYL ? " — please merge or say something if there's a problem, otherwise it will move to the DT maintainer queue soon!"
                  : staleness === Staleness.Abandoned ? " — it is considered abandoned!"
                  : staleness === Staleness.YSYL ? " — waiting for a DT maintainer!"
                  : "."}`);
    }

    // Remove the 'now' attribute because otherwise the comment would need editing every time
    // and that's spammy.
    const shallowPresentationInfoCopy = { ...info, now: "-" };

    display(``,
            `----------------------`,
            `<details><summary>Diagnostic Information: What the bot saw about this PR</summary>\n\n${'```json\n' + JSON.stringify(shallowPresentationInfoCopy, undefined, 2) + '\n```'}\n\n</details>`);

    return content.trimEnd();

    function emoji(n: boolean) {
        return n ? "✅" : "❌";
    }
}
