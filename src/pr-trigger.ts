// GH webhook entry point

import { getPRInfo } from "./queries/pr-query";
import { deriveStateForPR } from "./pr-info";
import { process as computeActions } from "./compute-pr-actions";
import { executePrActions } from "./execute-pr-actions";
import { mergeCodeOwnersOnGreen } from "./side-effects/merge-codeowner-prs";
import { runQueryToGetPRMetadataForSHA1 } from "./queries/SHA1-to-PR-query";
import { HttpRequest, Context } from "@azure/functions";
import { createEventHandler, EmitterWebhookEvent } from "@octokit/webhooks";
import { verify } from "@octokit/webhooks-methods";

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

// see https://github.com/octokit/webhooks.js/issues/491, and get rid of this when fixed
const eventNamesSillyCopy = [...eventNames];

const reply = (context: Context, status: number, body: string) => {
    context.res = { status, body };
    context.log.info(`${body} [${status}]`);
};

class IgnoredBecause {
    constructor(public reason: string) { }
}

export async function httpTrigger(context: Context, req: HttpRequest) {
    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const { headers, body } = req, githubId = headers["x-github-delivery"];
    const evName = headers["x-github-event"], evAction = body.action;

    context.log(`>>> HTTP Trigger [${
                  evName}.${evAction
                  }; gh: ${githubId
                  }; az: ${context.invocationId
                  }; node: ${process.version}]`);

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !(await verify(secret!, body, headers["x-hub-signature-256"]!)))
        return reply(context, 500, "This webhook did not come from GitHub");

    if (evName === "check_run" && evAction === "completed") {
        context.log(`>>>>>> name: ${body?.check_run?.name}, sha: ${body?.check_run?.head_sha}`);
        if (body?.check_run?.head_sha && body?.repository?.full_name === "DefinitelyTyped/DefinitelyTyped") {
            const pr = await runQueryToGetPRMetadataForSHA1("DefinitelyTyped", "DefinitelyTyped", body?.check_run?.head_sha);
            if (pr) {
                context.log(`>>>>>>>>> pr => num: ${pr.number}, title: "${pr.title}" closed: ${pr.closed}`);
            } else {
                context.log(`>>>>>>>>> pr => not found`);
            }
        }
    }

    const eventHandler = createEventHandler({ log: context.log });
    eventHandler.on(eventNamesSillyCopy, handleTrigger(context));
    return eventHandler.receive({ id: githubId, name: evName, payload: body } as EmitterWebhookEvent);
}

const handleTrigger = (context: Context) => async (event: EmitterWebhookEvent<typeof eventNames[number]>) => {
    const fullName = event.name + "." + event.payload.action;
    context.log(`Handling event: ${fullName}`);
    if (event.payload.sender.login === "typescript-bot" && fullName !== "check_suite.completed")
        return reply(context, 204, "Skipped webhook because it was triggered by typescript-bot");

    // Allow the bot to run side-effects which are not the 'core' function
    // of the review cycle, but are related to keeping DT running smoothly
    if (event.name === "check_suite")
        await mergeCodeOwnersOnGreen(event.payload);

    const pr: { number: number, title?: string } | IgnoredBecause = await prFromEvent(event);
    if (pr instanceof IgnoredBecause)
        return reply(context, 204, `Ignored: ${pr.reason}`);

    // wait 30s to process a trigger; if a new trigger comes in for the same PR, it supersedes the old one
    if (await debounce(30000, pr.number))
        return reply(context, 204, `Skipped webhook, superseded by a newer one for ${pr.number}`);

    context.log(`Getting info for PR ${pr.number} - ${pr.title || "(title not fetched)"}`);
    const info = await getPRInfo(pr.number);
    const prInfo = info.data.repository?.pullRequest;

    // If it didn't work, bail early
    if (!prInfo) {
        if (event.name === "issue_comment")
            return reply(context, 204, `NOOPing due to ${pr.number} not being a PR`);
        else
            return reply(context, 422, `No PR with this number exists, (${JSON.stringify(info)})`);
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

const prFromEvent = async (event: EmitterWebhookEvent<typeof eventNames[number]>) => {
    switch (event.name) {
        case "check_suite": return await prFromCheckSuiteEvent(event);
        case "issue_comment": return event.payload.issue;
        // "Parse" project_card.content_url according to repository.pulls_url
        case "project_card": {
            const url = event.payload.project_card.content_url;
            return url ? { number: +url.replace(/^.*\//, "") }
                : new IgnoredBecause(`Couldn't find PR number since content_url is missing: ${
                                        JSON.stringify(event.payload.project_card)}`);
        }
        case "pull_request": return event.payload.pull_request;
        case "pull_request_review": return event.payload.pull_request;
    }
};

const prFromCheckSuiteEvent = async (event: EmitterWebhookEvent<"check_suite">) => {
    // There is an `event.payload.check_suite.pull_requests` but it looks like
    // it's only populated for PRs in the other direction: going from DT to
    // forks (mostly by a pull bot).  See also `IgnoredBecause` below.
    //
    // So find it with a gql query instead:
    // TLDR: it's not in the API, so do a search (used on Peril for >3 years)
    // (there is an `associatedPullRequests` on a commit object, but that
    // doesn't work for commits on forks)
    const owner = event.payload.repository.owner.login;
    const repo = event.payload.repository.name;
    const sha = event.payload.check_suite.head_sha;
    const pr = await runQueryToGetPRMetadataForSHA1(owner, repo, sha);
    if (pr && !pr.closed) return pr;
    // no such PR, and we got related reverse PRs => just ignore it
    if (event.payload.check_suite.pull_requests.length > 0)
        return new IgnoredBecause(`No PRs for sha and ${
          event.payload.check_suite.pull_requests.length} reverse PRs (${sha})`);
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
