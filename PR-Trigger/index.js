// @ts-check

const {getPRInfo} = require("../bin/pr-info")
const compute = require("../bin/compute-pr-actions")
const {executePrActions} = require("../bin/execute-pr-actions")

/** @type {import("@azure/functions").AzureFunction} */
const httpTrigger = async function (context, _req) {
    /** @type {import("@azure/functions").HttpRequest} */
    const req = _req

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }

    context.log('HTTP trigger function processed a request.');
    const action = req.headers["x-github-event"]

    // TODO: Verify GH signature
    // https://github.com/microsoft/TypeScript-repos-automation/blob/40ae8b3db63fd0150938e82e47dcb63ce65f7a2d/TypeScriptRepoPullRequestWebhook/index.ts#L19

    // Bail if not a PR
    if (action !== "pull_request") {
        context.log.info("Skipped webhook, do not know how to handle the event: ", action)
        context.res = {
            status: 204,
            body: "NOOPing due to DT_PR_START & DT_PR_END"
        }
        return
    }
    
    /** @type {import("@octokit/webhooks").WebhookPayloadPullRequest} */
    const prWebhook = req.body
    const prNumber = prWebhook.pull_request.number

    // Allow running at the same time as the current dt bot
    if(!shouldRunOnPR(prNumber)) {
        context.log.info(`Skipped PR ${prNumber} because it did not fall in the PR range from process.env`)
        context.res = {
            status: 417,
            body: "Unknown webhook type"
        }
        return
    }

    context.log.info(`Getting info for PR ${prNumber} - ${prWebhook.pull_request.title}`)

    // Generate the info for the PR from scratch
    const info = await getPRInfo(prNumber);
    
    // If it didn't work, bail early
    if (info.type === "fail") {
        context.log.error(`Failed because of: ${info.message}`)
        
        context.res = {
            status: 422,
            body: `Failed because of: ${info.message}`
        };

        return;
    }

    // Convert the info to a set of actions for the bot
    const actions = compute.process(info);
    
    // Act on the actions
    await executePrActions(actions);

    // We are responding real late in the process, so it might show
    // as a timeout in GH a few times (e.g. after GH/DT/NPM lookups)
    context.res = {
        status: 200,
        body: actions 
    };

    function shouldRunOnPR(number) {
        if (!process.env.DT_PR_START) return true

        const lower = Number(process.env.DT_PR_START)
        const higher = Number(process.env.DT_PR_END)
        return lower < number && number < higher
    }
};

module.exports = httpTrigger;
