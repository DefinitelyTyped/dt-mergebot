import assert = require("assert");
import * as bot from "idembot";

export enum TravisResult {
    Unknown = "unknown",
    Pass = "pass",
    Fail = "fail",
    Missing = "missing",
}

export async function getTravisStatus(pr: bot.PullRequest): Promise<TravisResult> {
    assert(pr.state === "open");

    const status = await pr.getStatus();
    if (status.total_count === 0) {
        return TravisResult.Missing;
    }

    switch (status.state) {
        case "failure":
        case "error":
            return TravisResult.Fail;
        case "success":
            return TravisResult.Pass;
        case "pending":
        default:
            return TravisResult.Unknown;
    }
}
