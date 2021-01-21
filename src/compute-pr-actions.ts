import * as Comments from "./comments";
import * as urls from "./urls";
import { PrInfo, BotResult, FileInfo } from "./pr-info";
import { ReviewInfo } from "./pr-info";
import { noNullish, flatten, unique, sameUser, min, sha256, abbrOid } from "./util/util";
import * as dayjs from "dayjs";
import * as advancedFormat from "dayjs/plugin/advancedFormat";
dayjs.extend(advancedFormat);

type ColumnName =
    | "Needs Maintainer Action"
    | "Needs Maintainer Review"
    | "Other"
    | "Waiting for Author to Merge"
    | "Needs Author Action"
    | "Recently Merged"
    | "Waiting for Code Reviews";

type StalenessKind = typeof StalenessKinds[number];
const StalenessKinds = [ // all are also label names
    "Unmerged",
    "Abandoned",
    "Unreviewed",
] as const;

export type LabelName = typeof LabelNames[number];
export const LabelNames = [
    "Mergebot Error",
    "Has Merge Conflict",
    "The CI failed",
    "Revision needed",
    "New Definition",
    "Edits Owners",
    "Where is GH Actions?",
    "Owner Approved",
    "Other Approved",
    "Maintainer Approved",
    "Self Merge",
    "Popular package",
    "Critical package",
    "Edits Infrastructure",
    "Edits multiple packages",
    "Author is Owner",
    "No Other Owners",
    "Too Many Owners",
    "Untested Change",
    "Check Config",
    ...StalenessKinds,
] as const;

export interface Actions {
    targetColumn?: ColumnName;
    labels: LabelName[];
    responseComments: Comments.Comment[];
    shouldClose: boolean;
    shouldMerge: boolean;
    shouldUpdateLabels: boolean;
    shouldUpdateProjectColumn: boolean;
    shouldRemoveFromActiveColumns: boolean;
}

function createDefaultActions(): Actions {
    return {
        targetColumn: "Other",
        labels: [],
        responseComments: [],
        shouldClose: false,
        shouldMerge: false,
        shouldUpdateLabels: true,
        shouldUpdateProjectColumn: true,
        shouldRemoveFromActiveColumns: false,
    };
}

function createEmptyActions(): Actions {
    return {
        labels: [],
        responseComments: [],
        shouldClose: false,
        shouldMerge: false,
        shouldUpdateLabels: false,
        shouldUpdateProjectColumn: false,
        shouldRemoveFromActiveColumns: false,
    };
}

type Staleness = {
    readonly kind: StalenessKind;
    readonly days: number;
    readonly state: "fresh" | "attention" | "nearly" | "done";
    readonly explanation?: string;
    readonly doTimelineActions: (context: Actions) => void;
}

type ApproverKind = "maintainer" | "owner" | "other";

// used to pass around pr info with additional values
interface ExtendedPrInfo extends PrInfo {
    readonly orig: PrInfo;
    readonly editsInfra: boolean;
    readonly checkConfig: boolean;
    readonly authorIsOwner: boolean;
    readonly allOwners: string[];
    readonly otherOwners: string[];
    readonly noOtherOwners: boolean;
    readonly tooManyOwners: boolean;
    readonly editsOwners: boolean;
    readonly canBeSelfMerged: boolean;
    readonly hasValidMergeRequest: boolean; // has request following an offer
    readonly pendingCriticalPackages: readonly string[]; // critical packages that need owner approval
    readonly approved: boolean;
    readonly approverKind: ApproverKind;
    readonly requireMaintainer: boolean;
    readonly blessable: boolean;
    readonly approvedReviews: (ReviewInfo & { type: "approved" })[];
    readonly changereqReviews: (ReviewInfo & { type: "changereq" })[];
    readonly staleReviews: (ReviewInfo & { type: "stale" })[];
    readonly approvedBy: ApproverKind[];
    readonly hasChangereqs: boolean;
    readonly failedCI: boolean;
    readonly staleness?: Staleness;
    readonly packages: readonly string[];
    readonly hasMultiplePackages: boolean; // not counting infra files
    readonly hasDefinitions: boolean;
    readonly hasTests: boolean;
    readonly isUntested: boolean;
    readonly newPackages: readonly string[];
    readonly hasNewPackages: boolean;
    readonly hasEditedPackages: boolean;
    readonly needsAuthorAction: boolean;
    readonly reviewColumn: ColumnName;
    readonly isAuthor: (user: string) => boolean; // specialized version of sameUser
}
function extendPrInfo(info: PrInfo): ExtendedPrInfo {
    const isAuthor = (user: string) => sameUser(user, info.author);
    const authorIsOwner = info.pkgInfo.every(p => p.owners.some(isAuthor));
    const editsInfra = info.pkgInfo.some(p => p.name === null);
    const checkConfig = info.pkgInfo.some(p => p.files.some(f => f.kind === "package-meta"));
    const allOwners = unique(flatten(info.pkgInfo.map(p => p.owners)));
    const otherOwners = allOwners.filter(o => !isAuthor(o));
    const noOtherOwners = otherOwners.length === 0;
    const tooManyOwners = allOwners.length > 50;
    const editsOwners = info.pkgInfo.some(p => p.kind === "edit" && p.addedOwners.length + p.deletedOwners.length > 0);
    const packages = noNullish(info.pkgInfo.map(p => p.name));
    const hasMultiplePackages = packages.length > 1;
    const hasDefinitions = info.pkgInfo.some(p => p.files.some(f => f.kind === "definition"));
    const hasTests = info.pkgInfo.some(p => p.files.some(f => f.kind === "test"));
    const isUntested = hasDefinitions && !hasTests;
    const newPackages = noNullish(info.pkgInfo.map(p => p.kind === "add" ? p.name : null));
    const hasNewPackages = newPackages.length > 0;
    const hasEditedPackages = packages.length > newPackages.length;
    const requireMaintainer = editsInfra || checkConfig || hasMultiplePackages || isUntested || hasNewPackages || tooManyOwners;
    const blessable = !(hasNewPackages || editsInfra || noOtherOwners);
    const approvedReviews = info.reviews.filter(r => r.type === "approved") as ExtendedPrInfo["approvedReviews"];
    const changereqReviews = info.reviews.filter(r => r.type === "changereq") as ExtendedPrInfo["changereqReviews"];
    const staleReviews = info.reviews.filter(r => r.type === "stale") as ExtendedPrInfo["staleReviews"];
    const hasChangereqs = changereqReviews.length > 0;
    const approvedBy = getApprovedBy();
    const pendingCriticalPackages = getPendingCriticalPackages();
    const approverKind = getApproverKind();
    const approved = getApproved();
    const failedCI = info.ciResult === "fail";
    const canBeSelfMerged = info.ciResult === "pass" && !info.hasMergeConflict && approved;
    const hasValidMergeRequest = !!(info.mergeOfferDate && info.mergeRequestDate && info.mergeRequestDate > info.mergeOfferDate);
    const needsAuthorAction = failedCI || info.hasMergeConflict || hasChangereqs;
    //      => could be dropped from the extended info and replaced with: info.staleness?.kind === "Abandoned"
    const staleness = getStaleness();
    const reviewColumn = getReviewColumn();
    return {
        ...info, orig: info,
        authorIsOwner, editsInfra, checkConfig, allOwners, otherOwners, noOtherOwners, tooManyOwners, editsOwners,
        canBeSelfMerged, hasValidMergeRequest, pendingCriticalPackages, approved, approverKind,
        requireMaintainer, blessable, failedCI, staleness,
        packages, hasMultiplePackages, hasDefinitions, hasTests, isUntested, newPackages, hasNewPackages, hasEditedPackages,
        approvedReviews, changereqReviews, staleReviews, approvedBy, hasChangereqs,
        needsAuthorAction, reviewColumn, isAuthor,
    };

    // Staleness timeline configurations (except for texts that are all in `comments.ts`)
    function getStaleness() {
        const mkStaleness = makeStaleness(info.now, info.author, otherOwners);
        if (canBeSelfMerged && info.mergeOfferDate) return mkStaleness(
            "Unmerged", info.mergeOfferDate, 4, 9, 30, "CLOSE");
        if (needsAuthorAction) return mkStaleness(
            "Abandoned", info.lastActivityDate, 6, 22, 30, "CLOSE");
        if (!approved) return mkStaleness(
            "Unreviewed", info.lastPushDate, 6, 10, 17, "Needs Maintainer Action");
        return undefined;
    }

    function getApprovedBy() {
        return hasChangereqs ? []
            : approvedReviews.map(r => r.isMaintainer ? "maintainer"
                                       : allOwners.some(o => sameUser(o, r.reviewer)) ? "owner"
                                       : "other");
    }

    function getPendingCriticalPackages() {
        return noNullish(info.pkgInfo.map(p =>
            p.popularityLevel === "Critical" && !p.owners.some(o => approvedReviews.some(r => sameUser(o, r.reviewer)))
            ? p.name : null));
    }

    function getApproverKind() {
        const blessed = blessable && info.maintainerBlessed;
        const who: ApproverKind =
            requireMaintainer ? "maintainer" : ({
                "Well-liked by everyone": "other",
                "Popular": "owner",
                "Critical": "maintainer",
            } as const)[info.popularityLevel];
        return who === "maintainer" && blessed && !noOtherOwners ? "owner"
            : who === "owner" && noOtherOwners ? "maintainer"
            : who;
    }

    function getApproved() {
        if (approvedBy.includes("maintainer")) return true; // maintainer approval => no need for anything else
        return pendingCriticalPackages.length === 0 && approvedBy.length > 0
            && (approverKind === "other" || approvedBy.includes("maintainer") || approvedBy.includes(approverKind));
    }

    function getReviewColumn(): ColumnName {
        // Get the project column for review with least access
        // E.g. let people review, but fall back to the DT maintainers based on the access rights above
        return approverKind !== "maintainer" ? "Waiting for Code Reviews"
            : blessable ? "Needs Maintainer Review"
            : "Needs Maintainer Action";
    }

}

export function process(prInfo: BotResult,
                        extendedCallback: (info: ExtendedPrInfo) => void = _i => {}): Actions {
    if (prInfo.type === "remove") {
        if (prInfo.isDraft) {
            return {
                ...createEmptyActions(),
                targetColumn: "Needs Author Action",
                shouldUpdateProjectColumn: true,
            };
        } else {
            return {
                ...createEmptyActions(),
                shouldRemoveFromActiveColumns: true,
            };
        }
    }

    const context = createDefaultActions();
    const post = (c: Comments.Comment) => context.responseComments.push(c);

    if (prInfo.type === "error") {
        context.targetColumn = "Other";
        context.labels.push("Mergebot Error");
        post(Comments.HadError(prInfo.author, prInfo.message));
        return context;
    }

    // Collect some additional info
    const info = extendPrInfo(prInfo);
    extendedCallback(info);

    // General labelling and housekeeping
    const label = (label: LabelName, cond: unknown = true) => {
        const i = context.labels.indexOf(label);
        if (cond && i < 0) context.labels.push(label);
        else if (!cond && i >= 0) context.labels.splice(i, 1);
    };
    label("Has Merge Conflict", info.hasMergeConflict);
    label("The CI failed", info.failedCI);
    label("Revision needed", info.hasChangereqs);
    label("Critical package", info.popularityLevel === "Critical");
    label("Popular package", info.popularityLevel === "Popular");
    label("Other Approved", info.approvedBy.includes("other"));
    label("Owner Approved",
          info.approvedBy.includes("owner")
          && info.pendingCriticalPackages.length === 0); // and *all* owners of critical packages
    label("Maintainer Approved", info.approvedBy.includes("maintainer"));
    label("New Definition", info.hasNewPackages);
    label("Edits Owners", info.editsOwners);
    label("Edits Infrastructure", info.editsInfra);
    label("Edits multiple packages", info.hasMultiplePackages);
    label("Author is Owner", info.authorIsOwner);
    label("No Other Owners", info.hasEditedPackages && info.noOtherOwners);
    label("Too Many Owners", info.tooManyOwners);
    label("Check Config", info.checkConfig);
    label("Untested Change", info.isUntested);
    if (info.staleness?.state === "nearly" || info.staleness?.state === "done") label(info.staleness.kind);

    // Update intro comment
    post({ tag: "welcome", status: createWelcomeComment(info, post) });

    // Ping reviewers when needed
    const headCommitAbbrOid = abbrOid(info.headCommitOid);
    if (!(info.hasChangereqs || info.approvedBy.includes("owner") || info.approvedBy.includes("maintainer"))) {
        if (info.noOtherOwners) {
            if (info.popularityLevel !== "Critical") {
                post(Comments.PingReviewersOther(info.author, urls.review(info.pr_number)));
            }
        } else if (info.tooManyOwners) {
            post(Comments.PingReviewersTooMany(info.otherOwners));
        } else {
            post(Comments.PingReviewers(info.otherOwners, urls.review(info.pr_number)));
        }
    }

    // Some step should override this
    context.targetColumn = "Other";

    // Needs author attention (bad CI, merge conflicts)
    if (info.needsAuthorAction) {
        context.targetColumn = "Needs Author Action";
        if (info.hasMergeConflict) post(Comments.MergeConflicted(headCommitAbbrOid, info.author));
        if (info.failedCI) post(Comments.CIFailed(headCommitAbbrOid, info.author, info.ciUrl!));
        if (info.hasChangereqs) post(Comments.ChangesRequest(headCommitAbbrOid, info.author));
    }
    // CI is running; default column is Waiting for Reviewers
    else if (info.ciResult === "unknown") {
        context.targetColumn = "Waiting for Code Reviews";
    }
    // CI is missing
    else if (info.ciResult === "missing") {
        // This bot is faster than CI in coming back to give a response, and so the bot starts flipping between
        // a 'where is CI'-ish state and a 'got CI deets' state. To work around this, we wait a
        // minute since the last timeline push action before label/project states can be updated
        if (dayjs(info.now).diff(info.lastPushDate, "minutes") >= 1) {
            label("Where is GH Actions?");
        } else {
            delete context.targetColumn;
        }
    }
    // CI is green
    else if (info.ciResult === "pass") {
        if (!info.canBeSelfMerged) {
            context.targetColumn = info.reviewColumn;
        } else {
            label("Self Merge");
            // post even when merging, so it won't get deleted
            post(Comments.OfferSelfMerge(info.author,
                                         (info.tooManyOwners || info.hasMultiplePackages) ? [] : info.otherOwners,
                                         headCommitAbbrOid));
            if (info.hasValidMergeRequest) {
                context.shouldMerge = true;
                context.targetColumn = "Recently Merged";
            } else {
                context.targetColumn = "Waiting for Author to Merge";
            }
        }
        // Ping stale reviewers if any
        if (info.staleReviews.length > 0) {
            const { abbrOid } = min(info.staleReviews, (l, r) => +l.date - +r.date)!;
            const reviewers = info.staleReviews.map(r => r.reviewer);
            post(Comments.PingStaleReviewer(abbrOid, reviewers));
        }
    }

    if (!context.shouldMerge && info.mergeRequestUser) {
        post(Comments.WaitUntilMergeIsOK(info.mergeRequestUser, headCommitAbbrOid, urls.workflow));
    }

    // Timeline-related actions
    info.staleness?.doTimelineActions(context);

    return context;
}

function makeStaleness(now: Date, author: string, otherOwners: string[]) { // curried for convenience
    return (kind: StalenessKind, since: Date,
            freshDays: number, attnDays: number, nearDays: number,
            doneColumn: ColumnName | "CLOSE") => {
        const days = dayjs(now).diff(since, "days");
        const state = days <= freshDays ? "fresh" : days <= attnDays ? "attention" : days <= nearDays ? "nearly" : "done";
        const kindAndState = `${kind}:${state}`;
        const explanation = Comments.StalenessExplanations[kindAndState];
        const expires = dayjs(now).add(nearDays, "days").format("MMM Do");
        const comment = Comments.StalenessComment(author, otherOwners, expires)[kindAndState];
        const doTimelineActions = (context: Actions) => {
            if (comment !== undefined) {
                const tag = state === "done" ? kindAndState
                    : `${kindAndState}:${since.toISOString().replace(/T.*$/, "")}`;
                context.responseComments.push({ tag, status: comment });
            }
            if (state === "done") {
                if (doneColumn === "CLOSE") {
                    context.shouldClose = true;
                    context.shouldRemoveFromActiveColumns = true;
                } else {
                    context.targetColumn = doneColumn;
                }
            }
        };
        return { kind, days, state, explanation, doTimelineActions } as const;
    };
}

function createWelcomeComment(info: ExtendedPrInfo, post: (c: Comments.Comment) => void) {
    let content = "";
    function display(...lines: string[]) {
        lines.forEach(line => content += line + "\n");
    }

    const testsLink = info.hasNewPackages ? urls.testingNewPackages : urls.testingEditedPackages;

    const specialWelcome = !info.isFirstContribution ? `` :
        ` I see this is your first time submitting to DefinitelyTyped 👋 — I'm the local bot who will help you through the process of getting things through.`;
    display(`@${info.author} Thank you for submitting this PR!${specialWelcome}`,
            ``,
            `***This is a live comment which I will keep updated.***`);

    const criticalNum = info.pkgInfo.reduce((num,pkg) => pkg.popularityLevel === "Critical" ? num+1 : num, 0);
    if (criticalNum === 0 && info.popularityLevel === "Critical") throw new Error("Internal Error: unexpected criticalNum === 0");
    const requiredApprover =
        info.approverKind === "other" ? "type definition owners, DT maintainers or others"
        : info.approverKind === "maintainer" ? "a DT maintainer"
        : criticalNum <= 1 ? "type definition owners or DT maintainers"
        : "all owners or a DT maintainer";
    const RequiredApprover = requiredApprover[0]!.toUpperCase() + requiredApprover.substring(1);

    if (info.isUntested) {
        post(Comments.SuggestTesting(info.author, testsLink));
    } else if (info.editsInfra) {
        display(``,
                `This PR touches some part of DefinitelyTyped infrastructure, so ${requiredApprover} will need to review it. This is rare — did you mean to do this?`);
    }

    const announceList = (what: string, xs: readonly string[]) => `${xs.length} ${what}${xs.length !== 1 ? "s" : ""}`;
    const usersToString = (users: string[]) => users.map(u => (info.isAuthor(u) ? "✎" : "") + "@" + u).join(", ");
    const reviewLink = (f: FileInfo) =>
        `[\`${f.path.replace(/^types\/(.*\/)/, "$1")}\`](${
          urls.review(info.pr_number)}/${info.headCommitOid}#diff-${sha256(f.path)})`;

    display(``,
            `## ${announceList("package", info.packages)} in this PR`,
            ``);
    let addedSelfToManyOwners = 0;
    if (info.pkgInfo.length === 0) {
        display(`This PR is editing only infrastructure files!`);
    }
    for (const p of info.pkgInfo) {
        if (p.name === null) continue;
        const kind = p.kind === "add" ? " (*new!*)" : p.kind === "delete" ? " (*probably deleted!*)" : "";
        const urlPart = p.name.replace(/^(.*?)__(.)/, "@$1/$2");
        const authorIsOwner = !p.owners.some(info.isAuthor) ? [] : [`(author is owner)`];
        display([`* \`${p.name}\`${kind}`,
                 `[on npm](https://www.npmjs.com/package/${urlPart}),`,
                 `[on unpkg](https://unpkg.com/browse/${urlPart}@latest/)`,
                 ...authorIsOwner].join(" "));

        const approvers = info.approvedReviews.filter(r => p.owners.some(o => sameUser(o, r.reviewer))).map(r => r.reviewer);
        if (approvers.length) {
            display(`  - owner-approval: ${usersToString(approvers)}`);
        }
        const displayOwners = (what: string, owners: string[]) => {
            if (owners.length === 0) return;
            display(`  - ${announceList(`${what} owner`, owners)}: ${usersToString(owners)}`);
        };
        displayOwners("added", p.addedOwners);
        displayOwners("removed", p.deletedOwners);
        if (!info.authorIsOwner && p.owners.length >= 4 && p.addedOwners.some(info.isAuthor)) addedSelfToManyOwners++;

        let showSuspects = false;
        for (const file of p.files) {
            if (!file.suspect) continue;
            if (!showSuspects) display(`  - Config files to check:`);
            display(`    - ${reviewLink(file)}: ${file.suspect}`);
            showSuspects = true;
        }

    }
    if (addedSelfToManyOwners > 0) {
        display(``,
                `@${info.author}: I see that you have added yourself as an owner${addedSelfToManyOwners > 1 ? " to several packages" : ""}, are you sure you want to [become an owner](${urls.definitionOwners})?`);
    }

    // Lets the author know who needs to review this
    display(``,
            `## Code Reviews`,
            ``);
    if (info.hasNewPackages) {
        display(`This PR adds a new definition, so it needs to be reviewed by ${requiredApprover} before it can be merged.`);
    } else if (info.popularityLevel === "Critical" && !info.maintainerBlessed) {
        display(`Because this is a widely-used package, ${requiredApprover} will need to review it before it can be merged.`);
    } else if (!info.requireMaintainer) {
        const and = info.hasDefinitions && info.hasTests ? "and updated the tests (👏)" : "and there were no type definition changes";
        display(`Because you edited one package ${and}, I can help you merge this PR once someone else signs off on it.`);
    } else if (info.noOtherOwners && !info.maintainerBlessed) {
        display(`There aren't any other owners of this package, so ${requiredApprover} will review it.`);
    } else if (info.hasMultiplePackages && !info.maintainerBlessed) {
        display(`Because this PR edits multiple packages, it can be merged once it's reviewed by ${requiredApprover}.`);
    } else if (info.checkConfig && !info.maintainerBlessed) {
        display(`Because this PR edits the configuration file, it can be merged once it's reviewed by ${requiredApprover}.`);
    } else if (!info.maintainerBlessed) {
        display(`This PR can be merged once it's reviewed by ${requiredApprover}.`);
    } else {
        display("This PR can be merged once it's reviewed.");
    }

    display(``,
            `## Status`,
            ``,
            ` * ${emoji(!info.hasMergeConflict)} No merge conflicts`);

    const expectedResults = info.ciResult === "unknown" ? "finished" : "passed";
    display(` * ${emoji(info.ciResult === "pass")} Continuous integration tests have ${expectedResults}`);

    const approved = emoji(info.approved);

    if (info.hasNewPackages) {
        display(` * ${approved} Only ${requiredApprover} can approve changes when there are new packages added`);
    } else if (info.editsInfra) {
        const infraFiles = info.pkgInfo.find(p => p.name === null)!.files;
        const links = infraFiles.map(reviewLink);
        display(` * ${approved} ${RequiredApprover} needs to approve changes which affect DT infrastructure (${links.join(", ")})`);
    } else if (criticalNum > 1 && info.maintainerBlessed) {
        display(` * ${approved} ${RequiredApprover} needs to approve changes which affect more than one package`);
        for (const p of info.pkgInfo) {
            if (!(p.name && p.popularityLevel === "Critical")) continue;
            display(`   - ${emoji(!info.pendingCriticalPackages.includes(p.name))} ${p.name}`);
        }
    } else if (info.hasMultiplePackages) {
        display(` * ${approved} ${RequiredApprover} needs to approve changes which affect more than one package`);
    } else if (!info.requireMaintainer || info.maintainerBlessed) {
        display(` * ${approved} Most recent commit is approved by ${requiredApprover}`);
    } else if (info.noOtherOwners) {
        display(` * ${approved} ${RequiredApprover} can merge changes when there are no other reviewers`);
    } else if (info.checkConfig) {
        display(` * ${approved} ${RequiredApprover} needs to approve changes which affect module config files`);
    } else {
        display(` * ${approved} Only ${requiredApprover} can approve changes [without tests](${testsLink})`);
    }

    display(``);
    if (!info.canBeSelfMerged) {
        display(`Once every item on this list is checked, I'll ask you for permission to merge and publish the changes.`);
    } else {
        display(`All of the items on the list are green. **To merge, you need to post a comment including the string "Ready to merge"** to bring in your changes.`);
    }

    if (info.staleness && info.staleness.state !== "fresh") {
        const expl = info.staleness.explanation;
        display(``,
                `## Inactive`,
                ``,
                `This PR has been inactive for ${info.staleness.days} days${!expl ? "." : " — " + expl}`);
    }

    // Remove the 'now' attribute because otherwise the comment would need editing every time
    // and that's spammy.
    const shallowPresentationInfoCopy = { ...info.orig, now: "-" };

    display(``,
            `----------------------`,
            `<details><summary>Diagnostic Information: What the bot saw about this PR</summary>\n\n${
              "```json\n" + JSON.stringify(shallowPresentationInfoCopy, undefined, 2) + "\n```"
            }\n\n</details>`);

    return content.trimEnd();

    function emoji(n: boolean) {
        return n ? "✅" : "❌";
    }
}
