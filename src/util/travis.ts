import assert = require("assert");
import * as bot from "idembot";

export enum TravisResult {
    Unknown = "unknown",
    Pass = "pass",
    Fail = "fail",
    Missing = "missing",
}

export async function getTravisStatus(pr: bot.PullRequest): Promise<{ result: TravisResult, url: string | undefined }> {
    assert(pr.state === "open");

    const status = await pr.getStatus();
    if (status.total_count === 0) {
        return { result: TravisResult.Missing, url: undefined };
    }

    const url = (status.statuses.length > 0 && status.statuses[0].target_url) || undefined;
    switch (status.state) {
        case "failure":
        case "error":
            return { result: TravisResult.Fail, url };
        case "success":
            return { result: TravisResult.Pass, url };
        case "pending":
        default:
            return { result: TravisResult.Unknown, url: undefined };
    }
}
