import * as Comments from "./comments";
import { PrInfo, BotError, BotEnsureRemovedFromProject, BotNoPackages } from "./pr-info";
import { CIResult } from "./util/CIResult";
import { PackageInfo, ReviewInfo } from "./pr-info";
import { noNulls, flatten, unique } from "./util/util";

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

export enum ApprovalFlags {
    None = 0,
    Other = 1 << 0,
    Owner = 1 << 1,
    Maintainer = 1 << 2
}

export type DangerLevel =
    | "ScopedAndTested"
    | "ScopedAndUntested"
    | "ScopedAndConfiguration"
    | "MultiplePackagesEdited"
    | "Infrastructure";
function getDangerLevel(pkgInfo: readonly PackageInfo[]): DangerLevel {
    if (pkgInfo.find(p => p.name === null)) return "Infrastructure";
    if (pkgInfo.length === 0) {
        throw new Error("Internal Error: not infrastructure but no packages touched too");
    }
    if (pkgInfo.length > 1) {
        return "MultiplePackagesEdited";
    } else if (pkgInfo.some(p => p.files.some(f => f.kind === "package-meta"))) {
        return "ScopedAndConfiguration";
    } else if (pkgInfo.some(p => p.files.some(f => f.kind === "test"))) {
        return "ScopedAndTested";
    } else {
        return "ScopedAndUntested";
    }
}

// used to pass around pr info with additional values
interface ExtendedPrInfo extends PrInfo {
    readonly orig: PrInfo;
    readonly reviewLink: string;
    readonly editsInfra: boolean;
    readonly authorIsOwner: boolean;
    readonly allOwners: string[];
    readonly otherOwners: string[];
    readonly noOtherOwners: boolean;
    readonly tooManyOwners: boolean;
    readonly canBeMerged: boolean;
    readonly dangerLevel: DangerLevel;
    readonly approved: boolean;
    readonly approverKind: ApproverKinds;
    readonly blessable: boolean;
    readonly approvedReviews: (ReviewInfo & { type: "approved" })[];
    readonly changereqReviews: (ReviewInfo & { type: "changereq" })[];
    readonly staleReviews: (ReviewInfo & { type: "stale" })[];
    readonly approvalFlags: ApprovalFlags;
    readonly hasChangereqs: boolean;
    readonly failedCI: boolean;
    readonly staleness: Staleness;
    readonly packages: readonly string[];
    readonly newPackages: readonly string[];
    readonly hasNewPackages: boolean;
}
function extendPrInfo(info: PrInfo): ExtendedPrInfo {
    const reviewLink = uriForReview.replace(/{}/, ""+info.pr_number);
    const authorIsOwner = info.pkgInfo.every(p => p.owners && p.owners.map(o => o.toLowerCase()).includes(info.author.toLowerCase()));
    const editsInfra = info.pkgInfo.some(p => p.name === null);
    const allOwners = unique(flatten(info.pkgInfo.map(p => p.owners || [])));
    const otherOwners = allOwners.filter(o => info.author.toLowerCase() !== o.toLowerCase());
    const noOtherOwners = !allOwners.some(o => o.toLowerCase() !== info.author.toLowerCase());
    const tooManyOwners = allOwners.length > 50;
    const packages = noNulls(info.pkgInfo.map(p => p.name));
    const newPackages = noNulls(info.pkgInfo.map(p => p.owners ? null : p.name));
    const hasNewPackages = newPackages.length > 0;
    const blessable = !(hasNewPackages || editsInfra || noOtherOwners);
    const approvedReviews = info.reviews.filter(r => r.type === "approved") as ExtendedPrInfo["approvedReviews"];
    const changereqReviews = info.reviews.filter(r => r.type === "changereq") as ExtendedPrInfo["changereqReviews"];
    const staleReviews = info.reviews.filter(r => r.type === "stale") as ExtendedPrInfo["staleReviews"];
    const approvalFlags = approvedReviews.reduce((flags, r) => flags | (r.isMaintainer ? ApprovalFlags.Maintainer
                                                                        : allOwners.includes(r.reviewer) ? ApprovalFlags.Owner
                                                                        : ApprovalFlags.Other),
        ApprovalFlags.None);
    const hasChangereqs = changereqReviews.length > 0;
    const dangerLevel = getDangerLevel(info.pkgInfo);
    const { approved, approverKind } = getApproval(info, approvalFlags, dangerLevel, blessable, noOtherOwners, hasNewPackages);
    const canBeMerged = info.ciResult === CIResult.Pass && !info.hasMergeConflict && approved;;
    const failedCI = info.ciResult === CIResult.Fail;
    const staleness = getStaleness(info, canBeMerged);
    return {
        ...info, orig: info, reviewLink,
        authorIsOwner, editsInfra, allOwners, otherOwners, noOtherOwners, tooManyOwners,
        canBeMerged, dangerLevel, approved, approverKind, blessable, failedCI, staleness,
        packages, newPackages, hasNewPackages,
        approvedReviews, changereqReviews, staleReviews, approvalFlags, hasChangereqs
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
    context.labels["Edits Infrastructure"] = info.editsInfra;
    context.labels["Edits multiple packages"] = info.dangerLevel === "MultiplePackagesEdited";
    context.labels["Author is Owner"] = info.authorIsOwner;
    context.labels["No Other Owners"] = !info.hasNewPackages && info.noOtherOwners;
    context.labels["Too Many Owners"] = info.tooManyOwners;
    context.labels["Merge:Auto"] = info.canBeMerged;
    context.isReadyForAutoMerge = info.canBeMerged;
    context.labels["Config Edit"] = !info.hasNewPackages && info.dangerLevel === "ScopedAndConfiguration";
    context.labels["Untested Change"] = info.dangerLevel === "ScopedAndUntested";
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
                (info.tooManyOwners || !info.dangerLevel.startsWith("Scoped")) ? [] : info.otherOwners));
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

type ApproverKinds = "maintainers" | "owners" | "others";
function getApproval(info: PrInfo, approvalFlags: number, dangerLevel: DangerLevel, blessable: boolean, noOtherOwners: boolean, tooManyOwners: boolean) {
    const blessed = blessable && info.maintainerBlessed;
    const approvalFor = (who: ApproverKinds) => {
        const approverKind: ApproverKinds =
            who === "maintainers" && blessed ? "owners"
            : who === "owners" && noOtherOwners ? "maintainers"
            : who;
        const approved =
            !!(approvalFlags &
               (approverKind === "others" ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner | ApprovalFlags.Other)
                : approverKind === "owners" ? (ApprovalFlags.Maintainer | ApprovalFlags.Owner)
                : (ApprovalFlags.Maintainer)));
        return { approved, approverKind };
    };
    if (dangerLevel !== "ScopedAndTested" || tooManyOwners) return approvalFor("maintainers");
    if (info.popularityLevel === "Well-liked by everyone") return approvalFor("others");
    if (info.popularityLevel === "Popular") return approvalFor("owners");
    if (info.popularityLevel === "Critical") return approvalFor("maintainers");
    throw new Error("Unknown popularity level " + info.popularityLevel);
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
            `***This is a live comment which I will keep updated.***`,
            ``);

    const { approved, approverKind } = info;
    const requiredApprovers = approverKind === "others" ? "type definition owners, DT maintainers or others"
        : approverKind === "owners" ? "type definition owners or DT maintainers"
        : "DT maintainers";
    const aRequiredApprover = approverKind === "others" ? "someone"
        : approverKind === "owners" ? "an owner or a DT maintainer"
        : "a DT maintainer";
    const ARequiredApprover = aRequiredApprover[0].toUpperCase() + aRequiredApprover.substring(1);

    // Lets the author know who needs to review this
    let reviewerAdvisory: string | undefined;
    // Some kind of extra warning
    if (info.hasNewPackages) {
        reviewerAdvisory = `This PR adds a new definition, so it needs to be reviewed by ${aRequiredApprover} before it can be merged.`;
    } else if (info.popularityLevel === "Critical" && !info.maintainerBlessed) {
        reviewerAdvisory = `Because this is a widely-used package, ${aRequiredApprover} will need to review it before it can be merged.`;
    } else if (info.dangerLevel === "ScopedAndTested") {
        reviewerAdvisory = "Because you edited one package and updated the tests (👏), I can help you merge this PR once someone else signs off on it.";
    } else if (info.noOtherOwners && !info.maintainerBlessed) {
        reviewerAdvisory = `There aren't any other owners of this package, so ${aRequiredApprover} will review it.`;
    } else if (info.dangerLevel === "MultiplePackagesEdited" && !info.maintainerBlessed) {
        reviewerAdvisory = `Because this PR edits multiple packages, it can be merged once it's reviewed by ${aRequiredApprover}.`;
    } else if (info.dangerLevel === "ScopedAndConfiguration" && !info.maintainerBlessed) {
        reviewerAdvisory = `Because this PR edits the configuration file, it can be merged once it's reviewed by ${aRequiredApprover}.`;
    } else if (!info.maintainerBlessed) {
        reviewerAdvisory = `This PR can be merged once it's reviewed by ${aRequiredApprover}.`;
    } else {
        reviewerAdvisory = "This PR can be merged once it's reviewed.";
    }

    if (info.dangerLevel === "ScopedAndUntested") {
        display(`This PR doesn't modify any tests, so it's hard to know what's being fixed, and your changes might regress in the future. Have you considered [adding tests](${testsLink}) to cover the change you're making? Including tests allows this PR to be merged by yourself and the owners of this module. This can potentially save days of time for you.`);
    } else if (info.editsInfra) {
        display(`This PR touches some part of DefinitelyTyped infrastructure, so ${aRequiredApprover} will need to review it. This is rare — did you mean to do this?`);
    }

    if (info.packages.length > 0) {
        const links = info.packages.map(p => {
            const maybeNew = info.newPackages.includes(p) ? " (*new!*)" : "";
            const urlPart = p.replace(/^(.*?)__(.)/, "@$1/$2");
            return [`- \`${p}\`${maybeNew}`,
                    `[on npm](https://www.npmjs.com/package/${urlPart}),`,
                    `[on unpkg](https://unpkg.com/browse/${urlPart}@latest/)`
                   ].join(" ");
        }).join("\n");
        display(`## ${info.packages.length} package${info.packages.length > 1 ? "s" : ""} in this PR\n\n${links}`);
    }
    display(``,
            `## Code Reviews`,
            ``,
            reviewerAdvisory);

    display(``,
            `## Status`,
            ``,
            ` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);

    const expectedResults = info.ciResult === CIResult.Pending ? "finished" : "passed";
    display(` * ${emoji(info.ciResult === CIResult.Pass)} Continuous integration tests have ${expectedResults}`);

    if (info.hasNewPackages) {
        display(` * ${emoji(approved)} Only ${aRequiredApprover} can approve changes when there are new packages added`);
    } else if (info.editsInfra) {
        const infraFiles = info.pkgInfo.find(p => p.name === null)!.files;
        const links = infraFiles.map(f => `[\`${f.path}\`](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/${info.headCommitOid}/${f.path})`);
        display(` * ${emoji(approved)} ${ARequiredApprover} needs to approve changes which affect DT infrastructure (${links.join(", ")})`);
    } else if (info.dangerLevel === "MultiplePackagesEdited") {
        display(` * ${emoji(approved)} ${ARequiredApprover} needs to approve changes which affect more than one package`);
    } else if (info.dangerLevel === "ScopedAndTested" || info.maintainerBlessed) {
        display(` * ${emoji(approved)} Most recent commit is approved by ${requiredApprovers}`);
    } else if (info.noOtherOwners) {
        display(` * ${emoji(approved)} ${ARequiredApprover} can merge changes when there are no other reviewers`);
    } else if (info.maintainerBlessed) {
        display(` * ${emoji(approved)} Most recent commit is approved by ${requiredApprovers}`);
    } else if (info.dangerLevel === "ScopedAndConfiguration") {
        display(` * ${emoji(approved)} ${ARequiredApprover} needs to approve changes which affect module config files`);
        for (const pkg of info.pkgInfo) {
            for (const file of pkg.files) {
                if (!file.suspect) continue;
                display(`   - \`${file.path.replace(/^types\//, "")}\`: ${file.suspect}`);
            }
        }
    } else {
        display(` * ${emoji(approved)} Only ${aRequiredApprover} can approve changes [without tests](${testsLink})`);
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
