import * as bot from 'idembot';
const token: string = require(__dirname + '/../../dt-mergebot-token.json');

const Labels = {
    MergeConflict: "Has Merge Conflict"
};

function markTravisStatus(issue: bot.PullRequest) {
    if (!issue.isPullRequest) return;
    if (issue.state !== "open") return;
}

function markMergeState(issue: bot.PullRequest) {
    console.log(issue.mergeable_state);
    /*
    issue.setHasLabels({
        [Labels.MergeConflict]: issue.mergeable_state === "dirty"
    });
    */
}

const setup: bot.SetupOptions = {
    repos: [{ name: "DefinitelyTyped", owner: "DefinitelyTyped" }],
    rules: {
        pullRequests: {
            markTravisStatus,
            markMergeState
        }
    }
};

export = setup;
