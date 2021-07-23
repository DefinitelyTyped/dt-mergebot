import { verify } from "@octokit/webhooks-methods";
import { Context, HttpRequest } from "@azure/functions";

export async function httpLog(context: Context, req: HttpRequest) {
    const { headers, body } = req;
    const githubId = headers["x-github-delivery"];
    const event = headers["x-github-event"]!;
    const action = body.action;

    context.log(
    `>>> HTTP Trigger [${context.executionContext.functionName}] [${event}.${action}; gh: ${githubId}; az: ${context.invocationId}; node: ${process.version}]`
    );
}

export async function shouldRunRequest(req: HttpRequest, canHandleRequest?: (event: string, action: string) => boolean) {
    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const { headers, body } = req;

    const event = headers["x-github-event"]!;
    const action = body.action;

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && await verifyIsFromGitHub(req))
        return false;

    // Optional function for early bailing if it returns false
    if (canHandleRequest && !canHandleRequest(event, action))
        return false;

    return true;
}


export async function verifyIsFromGitHub(req: HttpRequest) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const { headers, body } = req;

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    return await verify(secret!, body, headers["x-hub-signature-256"]!);
}

