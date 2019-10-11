import * as Treeage from "treeage";
import * as Comments from "./comments";
import { PrInfo, ApprovalFlags } from "./pr-info";
import { TravisResult } from "./util/travis";

export type Context = typeof DefaultContext;
export const DefaultContext = {
    doNothing: false,
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
    shouldClose: false
};

export function createProcessor(context: Context) {
    const root = Treeage.create<PrInfo>({ pathMode: "first" });

    // General labelling and housekeeping
    root.addAlwaysAction(info => {
        context.labels["Critical Package"] = info.popularityLevel === "Critical";
        context.labels["Popular Package"] = info.popularityLevel === "Popular";
        context.labels["Other Approved"] = !!(info.approvalFlags & ApprovalFlags.Other);
        context.labels["Owner Approved"] = !!(info.approvalFlags & ApprovalFlags.Owner);
        context.labels["Maintainer Approved"] = !!(info.approvalFlags & ApprovalFlags.Maintainer);
        context.labels["New Definition"] = info.anyPackageIsNew;
        context.labels["Author is Owner"] = info.authorIsOwner;
    });

    // Update intro comment
    root.addAlwaysAction(info => {
        context.responseComments.push({
            tag: "welcome",
            status: createWelcomeComment(info)
        });
    });

    // Needs author attention (bad CI, merge conflicts)
    {
        const { group, map } = root.addGroup({
            failedCI: info => info.travisResult === TravisResult.Fail,
            mergeConflicted: info => info.hasMergeConflict,
            changesRequested: info => info.isChangesRequested
        });

        map.mergeConflicted.addAlwaysAction(info => {
            context.labels["Has Merge Conflict"] = true;
            context.responseComments.push(Comments.MergeConflicted(info.headCommitOid, info.author));
        });

        map.failedCI.addAlwaysAction(info => {
            context.labels["The Travis CI build failed"] = true;
            context.responseComments.push(Comments.TravisFailed(info.headCommitOid, info.author, info.travisUrl!));
        });

        map.changesRequested.addAlwaysAction(info => {
            context.labels["Revision needed"] = true;
            context.responseComments.push(Comments.ChangesRequest(info.headCommitOid, info.author));
        });

        group.addPath(daysStaleBetween(5, 7)).addAlwaysAction(info => {
            context.responseComments.push(Comments.NearlyAbandoned(info.headCommitAbbrOid));
        });

        group.addPath(daysStaleAtLeast(7)).addAlwaysAction(info => {
            context.responseComments.push(Comments.SorryAbandoned(info.headCommitAbbrOid));
            context.shouldClose = true;
        });

        group.addAlwaysAction(() => {
            context.targetColumn = "Needs Author Attention";
        });
    }

    // CI is running, just skip
    root.addPath(info => info.travisResult === TravisResult.Pending).addAlwaysAction(() => {
        context.doNothing = true;
    });

    // CI is missing
    root.addPath(info => info.travisResult === TravisResult.Missing).addAlwaysAction(() => {
        context.labels["Where is Travis?"] = true;
    });

    // CI is green
    const ciGreen = root.addPath(info => info.travisResult === TravisResult.Pass);
    {
        {
            // Approved
            const { group, map } = ciGreen.addGroup({
                approvedByOwner: info => !!(info.approvalFlags & ApprovalFlags.Owner),
                approvedByOther: info => !!(info.approvalFlags & ApprovalFlags.Other)
            });

            const autoMergeable = map.approvedByOwner.addPath(info =>
                 (info.popularityLevel === "Well-liked by everyone") &&
                (info.dangerLevel === "ScopedAndTested"));
            
            autoMergeable.addAlwaysAction(() => {
                context.targetColumn = "Ready to Merge";
            });
            const doMerge = autoMergeable.addPath(info => info.mergeIsRequested);
            autoMergeable.otherwise().addAlwaysAction((info) => {
                context.responseComments.push(Comments.AskForAutoMergePermission(info.author))
            });
        }

        {
            // Not approved
            const unapproved = ciGreen.otherwise();
            // Ping stale reviewers if any
            unapproved.addAlwaysAction(info => {
                for (const staleReviewer of info.reviewersWithStaleReviews) {
                    context.responseComments.push(Comments.PingStaleReviewer(staleReviewer.reviewedAbbrOid, staleReviewer.reviewer))
                }
            });
        }
    }

    // Should be unreachable; put in "Other"
    root.otherwise().addAlwaysAction(() => {
        context.targetColumn = "Other";
    });

    return (info: PrInfo) => root.process(info);
}

function hasFinalApproval(info: PrInfo) {

    return false;
}

function needsMaintainerApproval(info: PrInfo) {
    return true;
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
    introCommentLines.push(`----------------------`);
    introCommentLines.push(``);
    introCommentLines.push(`## Code Reviews`)
    introCommentLines.push(``);
    if (owners.length === 0) {
        if (info.anyPackageIsNew) {
            introCommentLines.push(`This is a new package, so I don't have anyone specific to ask for code reviews.`);
        } else {
            introCommentLines.push(`I didn't see any other owners to ask for code reviews.`);
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
