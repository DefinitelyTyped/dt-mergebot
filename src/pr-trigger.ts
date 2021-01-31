// GH webhook entry point

import { queryPRInfo, deriveStateForPR } from "./pr-info";
import { process as computeActions } from "./compute-pr-actions";
import { executePrActions } from "./execute-pr-actions";
import { mergeCodeOwnersOnGreen } from "./side-effects/merge-codeowner-prs";
import { runQueryToGetPRMetadataForSHA1 } from "./queries/SHA1-to-PR-query";
import { HttpRequest, Context } from "@azure/functions";
import { Webhooks, EventPayloads } from "@octokit/webhooks";

const prHandlers = new Map();

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
    if (!isDev && !webhooks.verify(req.body, webhooks.sign(req.body))) {
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
        // See https://github.com/maintainers/early-access-feedback/issues/114 for more context on getting a PR from a SHA
        // TLDR: it's not in the API, and this search hack has been in used on Peril for the last ~3 years
        // => Instead of an arbitrary search, use `associatedPullRequests` (https://developer.github.com/v4/changelog/2019-03-08-schema-changes/)
        const owner = webhook.repository.owner.login;
        const repo = webhook.repository.name;
        const sha = webhook.check_suite.head_sha;
        const pr = await runQueryToGetPRMetadataForSHA1(owner, repo, sha);
        if (!pr || pr.closed) {
            const whatFailed = !pr ? "a PR" : "an open PR";
            context.log.info(`Skipped webhook, could not find ${whatFailed} for the sha referenced in the status (${sha})`);
            context.res = {
                status: 204,
                body: `NOOPing due to not finding ${whatFailed} for the sha ${sha}`
            };
            return;
        }
        prNumber = pr.number;
    }

    if (prNumber === -1) throw new Error(`PR Number was not set from a webhook - ${event} on ${action}`);

    if (prHandlers.has(prNumber)) prHandlers.get(prNumber)(); // cancel older handler for the same pr
    const aborted = await new Promise(res => {
        const timeout = setTimeout(() => res(false), 30000);
        prHandlers.set(prNumber, () => {
            clearTimeout(timeout);
            res(true);
        });
    });
    if (aborted) {
        context.log.info(`Skipped webhook, superseded by a newer one for ${prNumber}`);
        context.res = {
            status: 204,
            body: "NOOPing due to a newer webhook"
        };
        return;
    }
    prHandlers.delete(prNumber);

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
