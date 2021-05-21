import { getPRInfo } from "./queries/pr-query";

// Allow all others to access this, we can
// tighten this down to the TS URLs if the route is abused
const headers = {
    "Content-Type": "text/json",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Origin": "*",
};

const httpTrigger: import("@azure/functions").AzureFunction = async function (context) {
    if (!context.req) throw new Error("No request in context");

    const notFound = (reason: string) => {
        context.res = {
            headers,
            status: 404,
            body: reason
        };
    };

    const prNumber = Number(context.req.query.number);
    if (!prNumber || isNaN(prNumber))  return notFound("No PR number");

    const info = await getPRInfo(prNumber);
    const prInfo = info.data.repository?.pullRequest;

    if (!prInfo)  return notFound("No PR metadata");

    const welcomeComment = prInfo.comments.nodes!.find(c =>  c && c.author?.login === "typescript-bot" && c.body.endsWith("<!--typescript_bot_welcome-->"));
    if (!welcomeComment || !welcomeComment.body || !welcomeComment.body.includes("```json")) return notFound("PR comment with JSON not found");

    // Extract the JSON from the comment
    const jsonText = welcomeComment.body.replace(/^[^]*```json\n([^]*)\n```[^]*$/, "$1");

    const response = { title: prInfo.title, ...JSON.parse(jsonText) };
    context.res = { status: 200, headers, body: response };
};

export default httpTrigger;
