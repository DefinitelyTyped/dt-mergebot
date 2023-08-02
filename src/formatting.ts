import { Octokit } from "@octokit/rest";
import { getAuthToken } from "./auth";

const octokit = new Octokit({
    auth: getAuthToken()
});

export async function dispatchFormatAndCommit(branch: string) {
    await octokit.request("POST /repos/DefinitelyTyped/DefinitelyTyped/actions/workflows/format-and-commit/dispatches", {
        headers: {
            "X-GitHub-Api-Version": "2022-11-28"
        },
        ref: branch,
    });
}
