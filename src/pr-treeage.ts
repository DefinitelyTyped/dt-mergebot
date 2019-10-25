import * as Treeage from "treeage";
import * as Comments from "./comments";
import { PrInfo } from "./pr-info";
import { TravisResult } from "./util/travis";

export type Context = typeof DefaultContext;
export const DefaultContext = {
    labels: {
        "Has Merge Conflict": false,
        "The Travis CI build failed": false
    },
    responseComments: [] as Comments.Comment[],
    shouldClose: false
};

export function defineGraph(context: Context) {
    const root = Treeage.create<PrInfo>({ pathMode: "first" });

    // Merge Conflicts
    {
        const conflicted = root.addPath(info => info.hasMergeConflict);
        conflicted.addAlwaysAction(info => {
            context.labels["Has Merge Conflict"] = true;
            context.responseComments.push(Comments.MergeConflicted(info.headCommitOid, info.author));
        });
        closeIfAbandoned(conflicted, context);
    }

    // Failing CI
    {
        const failedCI = root.addPath(info => info.travisResult === TravisResult.Fail);
        failedCI.addAlwaysAction(info => {
            context.labels["The Travis CI build failed"] = true;
            context.responseComments.push(Comments.TravisFailed(info.headCommitOid, info.author, info.travisUrl!));
        });
        closeIfAbandoned(failedCI, context);
    }

    const simple = root.addPath(info => info.complexity === "simple");
    

    root.addPath()
}

function closeIfAbandoned(node: Treeage.Node<PrInfo>, context: Context) {
    node.addPath(daysStaleBetween(6, 7)).addAlwaysAction(info => {
        context.responseComments.push(Comments.NearlyAbandoned(info.headCommitAbbrOid));
    });
    node.addPath(daysStale(7)).addAlwaysAction(info => {
        context.responseComments.push(Comments.SorryAbandoned(info.headCommitAbbrOid));
        context.shouldClose = true;
    });
}

function daysStale(days: number) {
    return (info: PrInfo) => info.stalenessInDays >= days;
}

function daysStaleBetween(lowerBoundInclusive: number, upperBoundExclusive: number) {
    return (info: PrInfo) => (info.stalenessInDays >= lowerBoundInclusive && info.stalenessInDays < upperBoundExclusive);
}
