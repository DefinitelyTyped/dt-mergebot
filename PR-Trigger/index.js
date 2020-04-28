// @ts-check

const {getPRInfo} = require("../bin/pr-info")
const compute = require("../bin/compute-pr-actions")
const {executePrActions} = require("../bin/execute-pr-actions")
const verify = require("@octokit/webhooks/verify");
const sign = require("@octokit/webhooks/sign");
const {runQueryToGetPRMetadataForStatus} = require("../bin/queries/status-to-PR-query")

/** @type {import("@azure/functions").AzureFunction} */
const httpTrigger = async function (context, _req) {
    /** @type {import("@azure/functions").HttpRequest} */
    const req = _req

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }

    context.log('HTTP trigger function received a request.');
    const event = req.headers["x-github-event"]

    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !verify(secret, req.body, sign(secret, req.body))) {
      context.res = {
        status: 500,
        body: "This webhook did not come from GitHub"
      };
      return;
    }
  
    // https://developer.github.com/webhooks/
    const acceptedEventsToActions = {
        "pull_request": ["opened", "closed", "reopened", "edited", "synchronized", "ready_for_review"],
        "pull_request_review": ["submitted", "edited", "dismissed"],
        "issue_comment": ["created", "edited", "deleted"],
        "status": ["*"]
    }

    const acceptedEvents = Object.keys(acceptedEventsToActions)

    // Bail if not a PR
    if (!acceptedEvents.includes(event)) {
        context.log.info(`Skipped webhook ${event}, do not know how to handle the event - accepts: ${acceptedEvents.join(", ")}`)
        context.res = {
            status: 204,
            body: "NOOPing due to unknown event"
        }
        return
    }
    
    /** @type {import("@octokit/webhooks").WebhookPayloadPullRequest | import("@octokit/webhooks").WebhookPayloadPullRequestReview | import("@octokit/webhooks").WebhookPayloadIssueComment | import("@octokit/webhooks").WebhookPayloadStatus } */
    const webhook = req.body
    const action = "action" in webhook ? webhook.action : "status"

    const allowListedActions = acceptedEventsToActions[event]
    if(!allowListedActions.includes(action) || allowListedActions.includes("*")) {
        context.log.info(`Skipped webhook, ${action} on ${event}, do not know how to handle the action`)
        context.res = {
            status: 204,
            body: `NOOPing due to not supporting ${action} on ${event}`
        }
        return
    }

    let prNumber = -1
    let prTitle = ""
    if ("pull_request" in webhook) {
        prNumber = webhook.pull_request.number
        prTitle = webhook.pull_request.title
    } else if("issue" in webhook) {
        prNumber = webhook.issue.number
        prTitle = webhook.issue.title
    } else if("sha" in webhook) {
        // See https://github.com/maintainers/early-access-feedback/issues/114 for more context on getting a PR from a SHA
        // TLDR: it's not in the API, and this search hack has been in used on Peril for the last ~3 years
        const repoString = webhook.repository.full_name
        const query = `${webhook.sha} type:pr is:open repo:${repoString}` 
        const pr = await runQueryToGetPRMetadataForStatus(query)
        if (pr) {
            prNumber = pr.number
            prTitle = pr.title
        }
    }
    
    if (prNumber === -1) throw new Error(`PR Number was not set from a webhook - ${event} on ${action}`)

    // Allow running at the same time as the current dt bot
    if (!shouldRunOnPR(prNumber)) {
        context.log.info(`Skipped PR ${prNumber} because it did not fall in the PR range from process.env`)
        context.res = {
            status: 204,
            body: `NOOPing due to ${prNumber} not being between DT_PR_START (${process.env.DT_PR_START}) & DT_PR_END (${process.env.DT_PR_END})`
        }
        return
    }

    context.log.info(`Getting info for PR ${prNumber} - ${prTitle}`)

    // Generate the info for the PR from scratch
    const info = await getPRInfo(prNumber);
    
    // If it didn't work, bail early
    if (info.type === "fail") {
        const isIssueNotPR = info.message === "No PR with this number exists" && "issue" in webhook
        if (isIssueNotPR) {
            context.res = {
                status: 204,
                body: `NOOPing due to ${prNumber} not being a PR`
            };
        } else {
            context.log.error(`Failed because of: ${info.message}`)
            
            context.res = {
                status: 422,
                body: `Failed because of: ${info.message}`
            };
        }

        return;
    }

    // Allow the info to declare that nothing should happen
    if (info.type === "noop") {
        context.log.info(`NOOPing because of: ${info.message}`)
            
        context.res = {
            status: 204,
            body: `NOOPing because of: ${info.message}`
        };
        return
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
