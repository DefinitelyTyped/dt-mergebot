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

    if (!prInfo) {
        context.res = {
            status: 404,
            body: "PR not found"
        };
        return;
    }

    const state = await deriveStateForPR(prInfo);
    if (!context.res) throw new Error("No Res");

    // Allow all others to access this,  we can 
    // tighten this down to the TS URLs if the route is abused
    const headers = {
        "Content-Type": "text/json",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Origin": "*",
    }

    context.res = { status: 200, headers, body: { state, info } };
};

export default httpTrigger;
