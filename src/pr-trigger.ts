// GH webhook entry point

import { queryPRInfo, deriveStateForPR } from "./pr-info";
import { process as computeActions } from "./compute-pr-actions";
import { executePrActions } from "./execute-pr-actions";
import { mergeCodeOwnersOnGreen } from "./side-effects/merge-codeowner-prs";
import { runQueryToGetPRMetadataForSHA1 } from "./queries/SHA1-to-PR-query";
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
    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const { headers, body } = req;

    context.log.info(`>>> HTTP Trigger [${
                       headers["x-github-event"]
                       }.${body.action
                       }; gh: ${headers["x-github-delivery"]
                       }; az: ${context.invocationId
                       }; node: ${process.version}]`);

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !verify(secret!, body, headers["x-hub-signature-256"]!)) {
        context.res = {
            status: 500,
            body: "This webhook did not come from GitHub"
        };
        return;
    }

    const eventHandler = createEventHandler({ log: context.log });
    eventHandler.on(eventNames as unknown as typeof eventNames[number], handleTrigger(context));
    return eventHandler.receive({
        id: headers["x-github-delivery"],
        name: headers["x-github-event"],
        payload: body,
    } as EmitterWebhookEvent);
}

const handleTrigger = (context: Context) => async (event: EmitterWebhookEvent<typeof eventNames[number]>) => {
    context.log.info(`Handling event: ${event.name}.${event.payload.action}`);
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

    const pr: { number: number, title?: string } = await prFromEvent(event, context);

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

const prFromEvent = async (event: EmitterWebhookEvent<typeof eventNames[number]>,
                           context: Context) => {
    switch (event.name) {
        case "check_suite": return await prFromCheckSuiteEvent(event, context);
        case "issue_comment": return event.payload.issue;
        // "Parse" project_card.content_url according to repository.pulls_url
        case "project_card": return { number: +event.payload.project_card.content_url.replace(/^.*\//, "") };
        case "pull_request": return event.payload.pull_request;
        case "pull_request_review": return event.payload.pull_request;
    }
};

const prFromCheckSuiteEvent = async (event: EmitterWebhookEvent<"check_suite">,
                                     context: Context) => {
    context.log.info(`check_suite with ${event.payload.check_suite.pull_requests.length} PRs`);
    if (event.payload.check_suite.pull_requests.length > 0) {
        context.log.info(`PR nums: ${event.payload.check_suite.pull_requests.map(p =>
          `${p.base.repo.url}:${p.head.repo.url}#${p.number}`).join("; ")}`);
    }
    // Would be nice if we could use `check_suite.pull_requests` but it's only
    // sometime populated, and when it is, it's with related PRs from other
    // repos

    // const pr0 = event.payload.check_suite.pull_requests[0];
    // if (pr0) return pr0;

    // So find it with a gql query instead:
    // TLDR: it's not in the API, so do a search (used on Peril for >3 years)
    // (there is an `associatedPullRequests` on a commit object, but that
    // doesn't work for commits on forks)
    const owner = event.payload.repository.owner.login;
    const repo = event.payload.repository.name;
    const sha = event.payload.check_suite.head_sha;
    const pr = await runQueryToGetPRMetadataForSHA1(owner, repo, sha);
    if (pr && !pr.closed) return pr;
    throw new Error(`PR Number not found: no ${!pr ? "PR" : "open PR"} for sha in status (${sha})`);
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
