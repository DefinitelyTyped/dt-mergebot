// @ts-check
import { deriveStateForPR } from "../bin/pr-info.js";
import { getPRInfo } from "../bin/queries/pr-query.js";

/** @type {import("@azure/functions").AzureFunction} */
const httpTrigger = async function (context) {
    const prNumber = Number(context.req.query.number);
    if (!prNumber || prNumber === NaN)  {
        context.res = {
            status: 404,
            body: "PR not found"
        };
        return;
    }

    const info = await getPRInfo(prNumber)
    const prInfo = info.data.repository?.pullRequest;

    const welcomeComment = prInfo.comments.nodes.filter(c => c.author.login === "typescript-bot" && c.body.includes("<!--typescript_bot_welcome-->"))
    console.log({ welcomeComment })
    if (!welcomeComment || !welcomeComment.body || !welcomeComment.body.includes("```json")) {
        context.res = {
            status: 404,
            body: "PR comment with JSON not found"
        };
        return;
    }
    
    // Extract the JSON from the comment
    const jsonText = welcomeComment.body.split("```json")[1].split("```")[0]

    // Allow all others to access this, we can 
    // tighten this down to the TS URLs if the route is abused
    const headers = {
        "Content-Type": "text/json",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Origin": "*",
    }

    context.res = { status: 200, headers, body: JSON.parse(jsonText) };
};

export default httpTrigger;
