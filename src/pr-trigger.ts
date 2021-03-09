// GH webhook entry point

import { queryPRInfo, deriveStateForPR } from "./pr-info";
import { process as computeActions } from "./compute-pr-actions";
import { executePrActions } from "./execute-pr-actions";
import { mergeCodeOwnersOnGreen } from "./side-effects/merge-codeowner-prs";
import { HttpRequest, Context } from "@azure/functions";
import { createEventHandler, EmitterWebhookEvent, verify } from "@octokit/webhooks";

const eventNames = [
    "check_suite.completed",
    "issue_comment.created",
    "issue_comment.deleted",
    "issue_comment.edited",
    "project_card.moved",
    "pull_request.closed",
    "pull_request.edited",
    "pull_request.opened",
    "pull_request.ready_for_review",
    "pull_request.reopened",
    "pull_request.synchronize",
    "pull_request_review.dismissed",
    "pull_request_review.submitted",
] as const;

export async function httpTrigger(context: Context, req: HttpRequest) {
    context.log(`[${process.version}] HTTP trigger function received a request.`);

    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !verify(secret!, req.body, req.headers["x-hub-signature-256"]!)) {
        context.res = {
            status: 500,
            body: "This webhook did not come from GitHub"
        };
        return;
    }

    const eventHandler = createEventHandler({ log: context.log });
    eventHandler.on(eventNames as unknown as typeof eventNames[number], handleTrigger(context));
    return eventHandler.receive({
        id: req.headers["x-github-delivery"],
        name: req.headers["x-github-event"],
        payload: req.body,
    } as EmitterWebhookEvent);
}

const handleTrigger = (context: Context) => async (event: EmitterWebhookEvent<typeof eventNames[number]>) => {
    if (event.payload.sender.login === "typescript-bot") {
        context.log.info(`Skipped webhook because it was triggered by typescript-bot`);
        context.res = {
            status: 204,
            body: `NOOPing because typescript-bot triggered the request`
        };
        return;
    }

    // Allow the bot to run side-effects which are not the 'core' function
    // of the review cycle, but are related to keeping DT running smoothly
    if (event.name === "check_suite") {
        await mergeCodeOwnersOnGreen(event.payload);
    }

    const pr: { number: number, title?: string } | undefined = prFromEvent(event);
    if (!pr) throw new Error(`PR Number was not set from a webhook - ${event.name} on ${event.payload.action}`);

    // wait 30s to process a trigger; if a new trigger comes in for the same PR, it supersedes the old one
    if (await debounce(30000, pr.number)) {
        context.log.info(`Skipped webhook, superseded by a newer one for ${pr.number}`);
        context.res = {
            status: 204,
            body: "NOOPing due to a newer webhook"
        };
        return;
    }

    context.log.info(`Getting info for PR ${pr.number} - ${pr.title || "(title not fetched)"}`);
    const info = await queryPRInfo(pr.number);
    const prInfo = info.data.repository?.pullRequest;

    // If it didn't work, bail early
    if (!prInfo) {
        if (event.name === "issue_comment") {
            context.res = {
                status: 204,
                body: `NOOPing due to ${pr.number} not being a PR`
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
};

const prFromEvent = (event: EmitterWebhookEvent<typeof eventNames[number]>) => {
    switch (event.name) {
        case "check_suite": return event.payload.check_suite.pull_requests[0];
        case "issue_comment": return event.payload.issue;
        // "Parse" project_card.content_url according to repository.pulls_url
        case "project_card": return { number: +event.payload.project_card.content_url.replace(/^.*\//, "") };
        case "pull_request": return event.payload.pull_request;
        case "pull_request_review": return event.payload.pull_request;
    }
};

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
