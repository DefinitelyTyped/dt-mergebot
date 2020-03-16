import assert = require("assert");

export enum TravisResult {
    Pending = "unknown",
    Pass = "pass",
    Fail = "fail",
    Missing = "missing",
}
