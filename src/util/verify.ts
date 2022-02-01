import { verify } from "@octokit/webhooks-methods";
import { Context, HttpRequest } from "@azure/functions";

export async function httpLog(context: Context, req: HttpRequest) {
    const { headers, body } = req;
    const githubId = headers["x-github-delivery"];
    const event = headers["x-github-event"]!;
    const action = body?.action;
    context.log(`>>> HTTP Trigger ${context.executionContext.functionName} [${
                  event}.${action
                  }; gh: ${githubId
                  }; az: ${context.invocationId
                  }; node: ${process.version}]`);
}

export async function shouldRunRequest(context: Context, req: HttpRequest, canHandleRequest?: (event: string, action: string) => boolean) {
    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    const fromGitHub = await verifyIsFromGitHub(req);
    if (!isDev && !fromGitHub) {
        context.log("Request did not come from GitHub");
        return false;
    }

    const { headers, body } = req;
    const event = headers["x-github-event"]!;
    const action = body.action;

    // Optional function for early bailing if it returns false
    if (canHandleRequest && !canHandleRequest(event, action)) {
        context.log("canHandleRequest returned false");
        return false;
    }

    return true;
}


export async function verifyIsFromGitHub(req: HttpRequest) {
    if (!req.headers["x-hub-signature-256"] || !req.rawBody) return false;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    return await verify(secret!, req.rawBody, req.headers["x-hub-signature-256"]);
}

