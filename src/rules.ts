import * as bot from "idembot";
import { getPRInfo, InfoKind } from "./pr-info";
import { Project } from "./project";
import { getComments, getLabels, getProjectColumn } from "./use-pr-info";

function makeSetLabels(): (pr: bot.PullRequest) => Promise<void> {
    const project = new Project();
    return async pr => {
        // Skip issues and closed PRs
        if (!(pr.isPullRequest && pr.state === "open"))
            return;

        const info = await getPRInfo(pr);
        console.log(pr.fullName, info);

        // Move to appropriate project
        const column = getProjectColumn(info);
        await project.setColumn(pr, column);

        // Apply labels
        const labels = getLabels(info);
        pr.setHasLabels(labels);

        for (const { tag, status } of getComments(info, pr.user.login))
            pr.addComment(tag, status);

        // merge
        if (info.kind === InfoKind.MergeAuto)
            pr.merge();
    };
}

const setup: bot.SetupOptions = {
    rules: {
        pullRequests: {
            setLabels: makeSetLabels(),
        },
    },
};

export = setup;
