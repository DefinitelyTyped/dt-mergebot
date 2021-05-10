export type ColumnName =
    | "Needs Maintainer Action"
    | "Needs Maintainer Review"
    | "Other"
    | "Waiting for Author to Merge"
    | "Needs Author Action"
    | "Recently Merged"
    | "Waiting for Code Reviews"
    | "*REMOVE*"; // special value: indicates closing the PR

export type PopularityLevel =
    | "Well-liked by everyone"
    | "Popular"
    | "Critical";

export type StalenessKind = typeof StalenessKinds[number];
const StalenessKinds = [ // all are also label names
    "Unmerged",
    "Abandoned",
    "Unreviewed",
] as const;

export type LabelName = typeof LabelNames[number];
export const LabelNames = [
    "Mergebot Error",
    "Has Merge Conflict",
    "The CI failed",
    "The CI is blocked",
    "Revision needed",
    "New Definition",
    "Edits Owners",
    "Where is GH Actions?",
    "Owner Approved",
    "Other Approved",
    "Maintainer Approved",
    "Self Merge",
    "Popular package",
    "Critical package",
    "Edits Infrastructure",
    "Possibly Edits Infrastructure",
    "Edits multiple packages",
    "Author is Owner",
    "No Other Owners",
    "Too Many Owners",
    "Untested Change",
    "Check Config",
    "Needs Actions Permission",
    ...StalenessKinds,
] as const;
