// GH webhook entry point

import { queryPRInfo, deriveStateForPR } from "./pr-info";
import { process as computeActions } from "./compute-pr-actions";
import { executePrActions } from "./execute-pr-actions";
import { mergeCodeOwnersOnGreen } from "./side-effects/merge-codeowner-prs";
import { HttpRequest, Context } from "@azure/functions";
import { Webhooks, EventPayloads } from "@octokit/webhooks";

export async function httpTrigger(context: Context, req: HttpRequest) {

    if (!(process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"])) {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }

    context.log(`[${process.version}] HTTP trigger function received a request.`);

    const event = req.headers["x-github-event"];
    if (!event) throw new Error(`Did not get a x-github-event header`);

    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const webhooks = new Webhooks({ secret });

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !webhooks.verify(req.body, req.headers["x-hub-signature-256"]!)) {
        context.res = {
            status: 500,
            body: "This webhook did not come from GitHub"
        };
        return;
    }

    // Allow the bot to run side-effects which are not the 'core' function
    // of the review cycle, but are related to keeping DT running smoothly
    if (event === "check_suite") {
        await mergeCodeOwnersOnGreen(req.body as EventPayloads.WebhookPayloadCheckSuite);
    }

    // https://developer.github.com/webhooks/
    const acceptedEventsToActions: Record<string, string[] | undefined> = {
        "pull_request": ["opened", "closed", "reopened", "edited", "synchronized", "ready_for_review"],
        "pull_request_review": ["submitted", "dismissed"],
        "issue_comment": ["created", "edited", "deleted"],
        "project_card": ["moved"],
        "check_suite": ["completed"],
    };
    const allowListedActions = acceptedEventsToActions[event];

    // Bail if not a PR
    if (!allowListedActions) {
        context.log.info(`Skipped webhook ${event}, do not know how to handle the event - accepts: ${
          Object.keys(acceptedEventsToActions).join(", ")}`);
        context.res = {
            status: 204,
            body: "NOOPing due to unknown event"
        };
        return;
    }

    const webhook = req.body;
    const action = "action" in webhook ? webhook.action : "status";

    if (webhook.sender.login === "typescript-bot") {
        context.log.info(`Skipped webhook because it was triggered by typescript-bot`);
        context.res = {
            status: 204,
            body: `NOOPing because typescript-bot triggered the request`
        };
        return;
    }

    if (!allowListedActions.includes(action) && !allowListedActions.includes("*")) {
        context.log.info(`Skipped webhook, ${action} on ${event}, do not know how to handle the action`);
        context.res = {
            status: 204,
            body: `NOOPing due to not supporting ${action} on ${event}`
        };
        return;
    }

    let prNumber = -1;
    let prTitle = "(title not fetched)"; // this is only used for logging, not worth an API lookup => not always set
    if ("pull_request" in webhook) {
        prNumber = webhook.pull_request.number;
        prTitle = webhook.pull_request.title;
    } else if ("issue" in webhook) {
        prNumber = webhook.issue.number;
        prTitle = webhook.issue.title;
    } else if ("project_card" in webhook) {
        // Hack to get the PR number, could be found directly only in `content_url`
        const cardURL = webhook.project_card.content_url;
        const numberInURL = cardURL.match(/\/\d+$/);
        if (!numberInURL) throw new Error(`Could not get PR for project card URL: ${cardURL}`);
        prNumber = +numberInURL[0].substring(1);
    } else if ("check_suite" in webhook) {
        const pr = webhook.check_suite.pull_requests[0];
        prNumber = pr.number;
    }

    if (prNumber === -1) throw new Error(`PR Number was not set from a webhook - ${event} on ${action}`);

    // wait 30s to process a trigger; if a new trigger comes in for the same PR, it supersedes the old one
    if (await debounce(30000, prNumber)) {
        context.log.info(`Skipped webhook, superseded by a newer one for ${prNumber}`);
        context.res = {
            status: 204,
            body: "NOOPing due to a newer webhook"
        };
        return;
    }

    context.log.info(`Getting info for PR ${prNumber} - ${prTitle}`);

    // Generate the info for the PR from scratch
    const info = await queryPRInfo(prNumber);
    const prInfo = info.data.repository?.pullRequest;

    // If it didn't work, bail early
    if (!prInfo) {
        const isIssueNotPR = "issue" in webhook;
        if (isIssueNotPR) {
            context.res = {
                status: 204,
                body: `NOOPing due to ${prNumber} not being a PR`
            };
        } else {
            context.log.error(`No PR with this number exists, (${JSON.stringify(info)})`);
            context.res = {
                status: 422,
                body: `No PR with this number exists, (${JSON.stringify(info)})`
            };
        }

        return;
    }

    // Convert the info to a set of actions for the bot
    const state = await deriveStateForPR(prInfo);
    const actions = computeActions(state);

    // Act on the actions
    await executePrActions(actions, prInfo);

    // We are responding real late in the process, so it might show
    // as a timeout in GH a few times (e.g. after GH/DT/NPM lookups)
    context.res = {
        status: 200,
        body: actions
    };
}

const waiters: Map<unknown, () => void> = new Map();
function debounce(delay: number, group: unknown) {
    waiters.get(group)?.(); // cancel older handler for the same pr, if one exists
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            waiters.delete(group);
            resolve(false);
        }, delay);
        waiters.set(group, () => {
            clearTimeout(timeout);
            resolve(true);
        });
    });
}
