import * as Comments from "./comments";
import { PrInfo, BotError, BotEnsureRemovedFromProject, BotNoPackages } from "./pr-info";
import { CIResult } from "./util/CIResult";
import { ReviewInfo } from "./pr-info";
import { noNulls, flatten, unique, sameUser } from "./util/util";
import { userInfo } from "os";

type ColumnName =
    | "Needs Maintainer Action"
    | "Needs Maintainer Review"
    | "Other"
    | "Waiting for Author to Merge"
    | "Needs Author Action"
    | "Recently Merged"
    | "Waiting for Code Reviews";

type LabelName =
    | "Mergebot Error"
    | "Has Merge Conflict"
    | "The CI failed"
    | "Revision needed"
    | "New Definition"
    | "Edits Owners"
    | "Where is GH Actions?"
    | "Owner Approved"
    | "Other Approved"
    | "Maintainer Approved"
    | "Merge:Auto"
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

function createDefaultActions(pr_number: number): Actions {
    return {
        pr_number,
        targetColumn: "Other",
        labels: {
            "Mergebot Error": false,
            "Has Merge Conflict": false,
            "The CI failed": false,
            "Revision needed": false,
            "New Definition": false,
            "Edits Owners": false,
            "Where is GH Actions?": false,
            "Owner Approved": false,
            "Other Approved": false,
            "Maintainer Approved": false,
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

const uriForReview = "https://github.com/DefinitelyTyped/DefinitelyTyped/pull/{}/files";
const uriForTestingEditedPackages = "https://github.com/DefinitelyTyped/DefinitelyTyped#editing-tests-on-an-existing-package";
const uriForTestingNewPackages = "https://github.com/DefinitelyTyped/DefinitelyTyped#testing";
const uriForDefinitionOwners = "https://github.com/DefinitelyTyped/DefinitelyTyped#definition-owners";

export enum ApprovalFlags {
    None = 0,
    Other = 1 << 0,
    Owner = 1 << 1,
    Maintainer = 1 << 2
}

// used to pass around pr info with additional values
interface ExtendedPrInfo extends PrInfo {
    readonly orig: PrInfo;
    readonly reviewLink: string;
    readonly editsInfra: boolean;
    readonly editsConfig: boolean;
    readonly authorIsOwner: boolean;
    readonly allOwners: string[];
    readonly otherOwners: string[];
    readonly noOtherOwners: boolean;
    readonly tooManyOwners: boolean;
    readonly editsOwners: boolean;
    readonly canBeMerged: boolean;
    readonly approved: boolean;
    readonly approverKind: ApproverKind;
    readonly requireMaintainer: boolean;
    readonly blessable: boolean;
    readonly approvedReviews: (ReviewInfo & { type: "approved" })[];
    readonly changereqReviews: (ReviewInfo & { type: "changereq" })[];
    readonly staleReviews: (ReviewInfo & { type: "stale" })[];
    readonly approvalFlags: ApprovalFlags;
    readonly hasChangereqs: boolean;
    readonly failedCI: boolean;
    readonly staleness: Staleness;
    readonly packages: readonly string[];
    readonly hasMultiplePackages: boolean; // not counting infra files
    readonly hasTests: boolean;
    readonly newPackages: readonly string[];
    readonly hasNewPackages: boolean;
    readonly isAuthor: (user: string) => boolean; // specialized version of sameUser
}
function extendPrInfo(info: PrInfo): ExtendedPrInfo {
    const isAuthor = (user: string) => sameUser(user, info.author);
    const reviewLink = uriForReview.replace(/{}/, ""+info.pr_number);
    const authorIsOwner = info.pkgInfo.every(p => p.owners.some(isAuthor));
    const editsInfra = info.pkgInfo.some(p => p.name === null);
    const editsConfig = info.pkgInfo.some(p => p.files.some(f => f.kind === "package-meta"));
    const allOwners = unique(flatten(info.pkgInfo.map(p => p.owners)));
    const otherOwners = allOwners.filter(o => !isAuthor(o));
    const noOtherOwners = allOwners.every(isAuthor);
    const tooManyOwners = allOwners.length > 50;
    const editsOwners = info.pkgInfo.some(p => p.kind === "edit" && p.addedOwners.length + p.deletedOwners.length > 0);
    const packages = noNulls(info.pkgInfo.map(p => p.name));
    const hasMultiplePackages = packages.length > 1;
    const hasTests = info.pkgInfo.some(p => p.files.some(f => f.kind === "test"));
    const newPackages = noNulls(info.pkgInfo.map(p => p.kind === "add" ? p.name : null));
    const hasNewPackages = newPackages.length > 0;
    const requireMaintainer = editsInfra || editsConfig || hasMultiplePackages || !hasTests || hasNewPackages || tooManyOwners;
    const blessable = !(hasNewPackages || editsInfra || noOtherOwners);
    const approvedReviews = info.reviews.filter(r => r.type === "approved") as ExtendedPrInfo["approvedReviews"];
    const changereqReviews = info.reviews.filter(r => r.type === "changereq") as ExtendedPrInfo["changereqReviews"];
    const staleReviews = info.reviews.filter(r => r.type === "stale") as ExtendedPrInfo["staleReviews"];
    const approvalFlags = approvedReviews.reduce(
        (flags, r) => flags | (r.isMaintainer ? ApprovalFlags.Maintainer : allOwners.includes(r.reviewer) ? ApprovalFlags.Owner : ApprovalFlags.Other),
        ApprovalFlags.None);
    const hasChangereqs = changereqReviews.length > 0;
    const approverKind = getApproverKind(info, requireMaintainer, blessable, noOtherOwners);
    const approved = getApproval(approvalFlags, approverKind);
    const canBeMerged = info.ciResult === CIResult.Pass && !info.hasMergeConflict && approved;;
    const failedCI = info.ciResult === CIResult.Fail;
    const staleness = getStaleness(info, canBeMerged);
    return {
        ...info, orig: info, reviewLink,
        authorIsOwner, editsInfra, editsConfig, allOwners, otherOwners, noOtherOwners, tooManyOwners, editsOwners,
        canBeMerged, approved, approverKind, requireMaintainer, blessable, failedCI, staleness,
        packages, hasMultiplePackages, hasTests, newPackages, hasNewPackages,
        approvedReviews, changereqReviews, staleReviews, approvalFlags, hasChangereqs,
        isAuthor
    };
}

export function process(prInfo: PrInfo | BotEnsureRemovedFromProject | BotNoPackages | BotError ): Actions {
    if (prInfo.type === "remove") {
        if (prInfo.isDraft) {
            return {
                ...createEmptyActions(prInfo.pr_number),
                targetColumn: "Needs Author Action",
                shouldUpdateProjectColumn: true
            };
        } else {
            return {
                ...createEmptyActions(prInfo.pr_number),
                shouldRemoveFromActiveColumns: true
            };
        };
    }

    if (prInfo.type === "no_packages") {
        return {
            ...createEmptyActions(prInfo.pr_number),
            targetColumn: "Needs Maintainer Action",
            shouldUpdateProjectColumn: true,
            labels: { "Edits Infrastructure": true },
            shouldUpdateLabels: true,
        };
    }

    const context = createDefaultActions(prInfo.pr_number);

    if (prInfo.type === "error") {
        context.targetColumn = "Other";
        context.labels["Mergebot Error"] = true;
        context.responseComments.push(Comments.HadError(prInfo.author, prInfo.message));
        return context;
    }

    // Collect some additional info
    const info = extendPrInfo(prInfo);

    // General labelling and housekeeping
    context.labels["Has Merge Conflict"] = info.hasMergeConflict;
    context.labels["The CI failed"] = info.failedCI;
    context.labels["Revision needed"] = info.hasChangereqs;
    context.labels["Critical package"] = info.popularityLevel === "Critical";
    context.labels["Popular package"] = info.popularityLevel === "Popular";
    context.labels["Other Approved"] = !!(info.approvalFlags & ApprovalFlags.Other);
    context.labels["Owner Approved"] = !!(info.approvalFlags & ApprovalFlags.Owner);
    context.labels["Maintainer Approved"] = !!(info.approvalFlags & ApprovalFlags.Maintainer);
    context.labels["New Definition"] = info.hasNewPackages;
    context.labels["Edits Owners"] = info.editsOwners;
    context.labels["Edits Infrastructure"] = info.editsInfra;
    context.labels["Edits multiple packages"] = info.hasMultiplePackages;
    context.labels["Author is Owner"] = info.authorIsOwner;
    context.labels["No Other Owners"] = !info.hasNewPackages && info.noOtherOwners;
    context.labels["Too Many Owners"] = info.tooManyOwners;
    context.labels["Merge:Auto"] = info.canBeMerged;
    context.isReadyForAutoMerge = info.canBeMerged;
    context.labels["Config Edit"] = !info.hasNewPackages && info.editsConfig;
    context.labels["Untested Change"] = !info.hasTests;
    context.labels["Merge:YSYL"] = info.staleness === Staleness.YSYL;
    context.labels["Abandoned"] = info.staleness === Staleness.Abandoned;

    // Update intro comment
    context.responseComments.push({
        tag: "welcome",
        status: createWelcomeComment(info)
    });

    // Ping reviewers when needed
    if (!info.hasChangereqs && !(info.approvalFlags & (ApprovalFlags.Owner | ApprovalFlags.Maintainer))) {
        if (info.noOtherOwners) {
            if (info.popularityLevel !== "Critical") {
                context.responseComments.push(Comments.PingReviewersOther(info.author, info.reviewLink));
            }
        } else if (info.tooManyOwners) {
            context.responseComments.push(Comments.PingReviewersTooMany(info.otherOwners));
        } else {
            context.responseComments.push(Comments.PingReviewers(info.otherOwners, info.reviewLink));
        }
    }

    // Some step should override this
    context.targetColumn = "Other";

    // Needs author attention (bad CI, merge conflicts)
    if (info.failedCI || info.hasMergeConflict || info.hasChangereqs) {
        context.targetColumn = "Needs Author Action";

        if (info.hasMergeConflict) {
            context.responseComments.push(Comments.MergeConflicted(info.headCommitAbbrOid, info.author));
        }
        if (info.failedCI) {
            context.responseComments.push(Comments.CIFailed(info.headCommitAbbrOid, info.author, info.ciUrl!));
        }
        if (info.hasChangereqs) {
            context.responseComments.push(Comments.ChangesRequest(info.headCommitAbbrOid, info.author));
        }

        // Could be abandoned
        switch (info.staleness) {
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
    // Stale & doesn't need author attention => move to maintainer queue
    // ("Abandoned" can happen here for a PR that is not broken, but didn't get any supporting reviews for a long time)
    else if (info.staleness === Staleness.YSYL || info.staleness === Staleness.Abandoned) {
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
        if (!info.canBeMerged) {
            context.targetColumn = projectBoardForReviewWithLeastAccess(info);
        }
        else if (info.mergeIsRequested) {
            context.shouldMerge = true;
            context.targetColumn = "Recently Merged";
        }
        else {
            context.responseComments.push(Comments.AskForAutoMergePermission(
                info.author,
                (info.tooManyOwners || info.hasMultiplePackages) ? [] : info.otherOwners));
            context.targetColumn = "Waiting for Author to Merge";
        }

        // Ping stale reviewers if any
        if (info.staleReviews.length > 0) {
            const oid = info.staleReviews.slice().sort((l, r) => l.date.getTime() - r.date.getTime())[0].abbrOid;
            const reviewers = info.staleReviews.map(r => r.reviewer);
            context.responseComments.push(Comments.PingStaleReviewer(oid, reviewers));
        }
    }

    // This bot is faster than CI in coming back to give a response, and so the bot starts flipping between
    // a 'where is CI'-ish state and a 'got CI deets' state. To work around this, we wait a 
    // minute since the last timeline push action before label/project states can be updated

    const oneMinute = 60 * 1000;
    const tooEarlyForLabelsOrProjects = info.lastPushDate.getTime() + oneMinute < (new Date(prInfo.now)).getTime();
    context.shouldUpdateLabels = tooEarlyForLabelsOrProjects;
    context.shouldUpdateProjectColumn = tooEarlyForLabelsOrProjects;

    return context;
}

type ApproverKind = "maintainers" | "owners" | "others";

function getApproverKind(info: PrInfo, requireMaintainer: boolean, blessable: boolean, noOtherOwners: boolean) {
    const blessed = blessable && info.maintainerBlessed;
    const who: ApproverKind | undefined =
        requireMaintainer ? "maintainers"
        : info.popularityLevel === "Well-liked by everyone" ? "others"
        : info.popularityLevel === "Popular" ? "owners"
        : info.popularityLevel === "Critical" ? "maintainers"
        : undefined;
    if (!who) throw new Error("Unknown popularity level " + info.popularityLevel);
    return who === "maintainers" && blessed && !noOtherOwners ? "owners"
        : who === "owners" && noOtherOwners ? "maintainers"
        : who;
}

function getApproval(approvalFlags: number, approverKind: ApproverKind) {
    return !!(approvalFlags &
              (approverKind === "others" ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner | ApprovalFlags.Other)
               : approverKind === "owners" ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner)
               : (ApprovalFlags.Maintainer)));
}

/** E.g. let people review, but fall back to the DT maintainers based on the access rights above */
function projectBoardForReviewWithLeastAccess(info: ExtendedPrInfo): ColumnName {
    return info.approverKind !== "maintainers" ? "Waiting for Code Reviews"
        : info.blessable ? "Needs Maintainer Review"
        : "Needs Maintainer Action";
}

const enum Staleness {
    Fresh,
    PayAttention,
    NearlyYSYL,
    YSYL,
    NearlyAbandoned,
    Abandoned,
}

function getStaleness(info: PrInfo, canBeMerged: boolean) {
    return canBeMerged
        ? (info.stalenessInDays <= 2 ? Staleness.Fresh
           : info.stalenessInDays <= 4 ? Staleness.PayAttention
           : info.stalenessInDays <= 8 ? Staleness.NearlyYSYL
           : Staleness.YSYL)
        : (info.stalenessInDays <= 6 ? Staleness.Fresh
           : info.stalenessInDays <= 22 ? Staleness.PayAttention
           : info.stalenessInDays <= 30 ? Staleness.NearlyAbandoned
           : Staleness.Abandoned);
}

function createWelcomeComment(info: ExtendedPrInfo) {
    let content: string = "";
    function display(...lines: string[]) {
        lines.forEach(line => content += line + "\n");
    }

    const testsLink = info.hasNewPackages ? uriForTestingNewPackages : uriForTestingEditedPackages;

    const specialWelcome = !info.isFirstContribution ? `` :
        ` I see this is your first time submitting to DefinitelyTyped 👋 — I'm the local bot who will help you through the process of getting things through.`;
    display(`@${info.author} Thank you for submitting this PR!${specialWelcome}`,
            ``,
            `***This is a live comment which I will keep updated.***`);

    const [ aRequiredApprover, requiredApprovers ] =
        info.approverKind === "others" ? ["someone", "type definition owners, DT maintainers or others"]
        : info.approverKind === "owners" ? ["an owner or a DT maintainer", "type definition owners or DT maintainers"]
        : ["a DT maintainer", "DT maintainers"];
    const ARequiredApprover = aRequiredApprover[0].toUpperCase() + aRequiredApprover.substring(1);

    if (!info.hasTests) {
        display(``,
                `This PR doesn't modify any tests, so it's hard to know what's being fixed, and your changes might regress in the future. Have you considered [adding tests](${testsLink}) to cover the change you're making? Including tests allows this PR to be merged by yourself and the owners of this module. This can potentially save days of time for you.`);
    } else if (info.editsInfra) {
        display(``,
                `This PR touches some part of DefinitelyTyped infrastructure, so ${aRequiredApprover} will need to review it. This is rare — did you mean to do this?`);
    }

    const announceList = (what: string, xs: readonly string[]) => `${xs.length} ${what}${xs.length > 1 ? "s" : ""}`
    if (info.packages.length === 0) { // should not happen atm
        display(``,
                `## ?? Infrastructure-only PR ??`);
    } else {
        display(``,
                `## ${announceList("package", info.packages)} in this PR`,
                ``);
        let addedSelfToManyOwners = 0;
        for (const p of info.pkgInfo) {
            if (p.name === null) continue;
            const kind = p.kind === "add" ? " (*new!*)" : p.kind === "delete" ? " (*probably deleted!*)" : "";
            const urlPart = p.name.replace(/^(.*?)__(.)/, "@$1/$2");
            display([`- \`${p.name}\`${kind}`,
                     `[on npm](https://www.npmjs.com/package/${urlPart}),`,
                     `[on unpkg](https://unpkg.com/browse/${urlPart}@latest/)`
                    ].join(" "));
            const displayOwners = (what: string, owners: string[]) => {
                if (owners.length === 0) return;
                display(`  **${announceList(`${what} owner`, owners)}:** ${owners.map(o => (info.isAuthor(o) ? "✎" : "") + "@"+o).join(", ")}`);
            };
            displayOwners("added", p.addedOwners);
            displayOwners("removed", p.deletedOwners);
            if (!info.authorIsOwner && p.owners.length >= 4 && p.addedOwners.some(info.isAuthor)) addedSelfToManyOwners++;
        }
        if (addedSelfToManyOwners) {
            display(``,
                    `@${info.author}: I see that you have added yourself as an owner${addedSelfToManyOwners > 1 ? " to several packages" : ""}, are you sure you want to [become an owner](${uriForDefinitionOwners})?`);
        }
    }

    // Lets the author know who needs to review this
    display(``,
            `## Code Reviews`,
            ``);
    if (info.hasNewPackages) {
        display(`This PR adds a new definition, so it needs to be reviewed by ${aRequiredApprover} before it can be merged.`);
    } else if (info.popularityLevel === "Critical" && !info.maintainerBlessed) {
        display(`Because this is a widely-used package, ${aRequiredApprover} will need to review it before it can be merged.`);
    } else if (!info.requireMaintainer) {
        display("Because you edited one package and updated the tests (👏), I can help you merge this PR once someone else signs off on it.");
    } else if (info.noOtherOwners && !info.maintainerBlessed) {
        display(`There aren't any other owners of this package, so ${aRequiredApprover} will review it.`);
    } else if (info.hasMultiplePackages && !info.maintainerBlessed) {
        display(`Because this PR edits multiple packages, it can be merged once it's reviewed by ${aRequiredApprover}.`);
    } else if (info.editsConfig && !info.maintainerBlessed) {
        display(`Because this PR edits the configuration file, it can be merged once it's reviewed by ${aRequiredApprover}.`);
    } else if (!info.maintainerBlessed) {
        display(`This PR can be merged once it's reviewed by ${aRequiredApprover}.`);
    } else {
        display("This PR can be merged once it's reviewed.");
    }

    display(``,
            `## Status`,
            ``,
            ` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);

    const expectedResults = info.ciResult === CIResult.Pending ? "finished" : "passed";
    display(` * ${emoji(info.ciResult === CIResult.Pass)} Continuous integration tests have ${expectedResults}`);

    const approved = emoji(info.approved);
    if (info.hasNewPackages) {
        display(` * ${approved} Only ${aRequiredApprover} can approve changes when there are new packages added`);
    } else if (info.editsInfra) {
        const infraFiles = info.pkgInfo.find(p => p.name === null)!.files;
        const links = infraFiles.map(f => `[\`${f.path}\`](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/${info.headCommitOid}/${f.path})`);
        display(` * ${approved} ${ARequiredApprover} needs to approve changes which affect DT infrastructure (${links.join(", ")})`);
    } else if (info.hasMultiplePackages) {
        display(` * ${approved} ${ARequiredApprover} needs to approve changes which affect more than one package`);
    } else if (!info.requireMaintainer || info.maintainerBlessed) {
        display(` * ${approved} Most recent commit is approved by ${requiredApprovers}`);
    } else if (info.noOtherOwners) {
        display(` * ${approved} ${ARequiredApprover} can merge changes when there are no other reviewers`);
    } else if (info.maintainerBlessed) {
        display(` * ${approved} Most recent commit is approved by ${requiredApprovers}`);
    } else if (info.editsConfig) {
        display(` * ${approved} ${ARequiredApprover} needs to approve changes which affect module config files`);
        for (const pkg of info.pkgInfo) {
            for (const file of pkg.files) {
                if (!file.suspect) continue;
                display(`   - \`${file.path.replace(/^types\//, "")}\`: ${file.suspect}`);
            }
        }
    } else {
        display(` * ${approved} Only ${aRequiredApprover} can approve changes [without tests](${testsLink})`);
    }

    display(``);
    if (!info.canBeMerged) {
        display(`Once every item on this list is checked, I'll ask you for permission to merge and publish the changes.`);
    } else {
        display(`All of the items on the list are green. **To merge, you need to post a comment including the string "Ready to merge"** to bring in your changes.`);
    }

    if (info.staleness !== Staleness.Fresh) {
        display(``,
                `## Inactive`,
                ``,
                `This PR has been inactive for ${info.stalenessInDays} days${
                  info.staleness === Staleness.NearlyAbandoned ? " — it is considered nearly abandoned!"
                  : info.staleness === Staleness.NearlyYSYL ? " — please merge or say something if there's a problem, otherwise it will move to the DT maintainer queue soon!"
                  : info.staleness === Staleness.Abandoned ? " — it is considered abandoned!"
                  : info.staleness === Staleness.YSYL ? " — waiting for a DT maintainer!"
                  : "."}`);
    }

    // Remove the 'now' attribute because otherwise the comment would need editing every time
    // and that's spammy.
    const shallowPresentationInfoCopy = { ...info.orig, now: "-" };

    display(``,
            `----------------------`,
            `<details><summary>Diagnostic Information: What the bot saw about this PR</summary>\n\n${'```json\n' + JSON.stringify(shallowPresentationInfoCopy, undefined, 2) + '\n```'}\n\n</details>`);

    return content.trimEnd();

    function emoji(n: boolean) {
        return n ? "✅" : "❌";
    }
}
