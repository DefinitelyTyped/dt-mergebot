import { ColumnName, PopularityLevel } from "./basic";
import { PR_repository_pullRequest,
         PR_repository_pullRequest_commits_nodes_commit_checkSuites,
         PR_repository_pullRequest_timelineItems,
         PR_repository_pullRequest_comments_nodes,
} from "./queries/schema/PR";
import { getMonthlyDownloadCount } from "./util/npm";
import { fetchFile as defaultFetchFile } from "./util/fetchFile";
import { noNullish, someLast, sameUser, authorNotBot, max, abbrOid } from "./util/util";
import * as comment from "./util/comment";
import * as urls from "./urls";
import * as HeaderParser from "@definitelytyped/header-parser";
import * as jsonDiff from "fast-json-patch";

const CriticalPopularityThreshold = 5_000_000;
const NormalPopularityThreshold = 200_000;

// Some error found, will be passed to `process` to report in a comment
interface BotError {
    readonly type: "error";
    readonly now: Date;
    readonly message: string;
    readonly author: string | undefined;
}

interface BotEnsureRemovedFromProject {
    readonly type: "remove";
    readonly now: Date;
    readonly message: string;
    readonly isDraft: boolean;
}

export type PackageInfo = {
    name: string | null; // null => not in a package (= infra files)
    kind: "edit" | "add" | "delete";
    files: FileInfo[];
    owners: string[]; // existing owners on master
    addedOwners: string[];
    deletedOwners: string[];
    popularityLevel: PopularityLevel;
};

type FileKind = "test" | "definition" | "markdown" | "package-meta" | "package-meta-ok"| "infrastructure";

export type FileInfo = {
    path: string,
    kind: FileKind,
    suspect?: string // reason for a file being "package-meta" rather than "package-meta-ok"
};

export type ReviewInfo = {
    type: string,
    reviewer: string,
    date: Date
} & (
    | { type: "approved", isMaintainer: boolean }
    | { type: "changereq" }
    | { type: "stale", abbrOid: string }
);

export type CIResult = "unknown" | "pass" | "fail" | "missing" | "action_required";

export interface PrInfo {
    readonly type: "info";

    /** ISO8601 date string for the time the PR info was created at */
    readonly now: Date;

    readonly pr_number: number;

    /**
     * The head commit of this PR (full format)
     */
    readonly headCommitOid: string;

    /**
     * The GitHub login of the PR author
     */
    readonly author: string;

    /**
     * The CI status of the head commit
     */
    readonly ciResult: CIResult;

    /**
     * A link to the log for the failing CI if it exists
     */
    readonly ciUrl?: string;

    /**
     * An ID for a check suite which could need re-running
     */
    readonly reRunCheckSuiteIDs?: number[];

    /**
     * True if the PR has a merge conflict
     */
    readonly hasMergeConflict: boolean;

    /**
     * The date the latest commit was pushed to GitHub
     */
    readonly lastPushDate: Date;

    /**
     * The date of the last activity, including non-bot comments
     */
    readonly lastActivityDate: Date;

    /**
     * Name of column used if a maintainer blessed this PR
     */
    readonly maintainerBlessed?: ColumnName;

    /**
     * The time we posted a merge offer, if any (required for merge request in addition to passing CI and a review)
     */
    readonly mergeOfferDate?: Date;

    /*
     * Time of a "ready to merge" request and the requestor
     */
    readonly mergeRequestDate?: Date;
    readonly mergeRequestUser?: string;

    readonly isFirstContribution: boolean;

    /*
     * True if there are more files than we can fetch from the initial query (or no files)
     */
    readonly tooManyFiles: boolean;
    /*
     * True for PRs with over 5k line chanbges (top ~3%)
     */
    readonly hugeChange: boolean;

    readonly popularityLevel: PopularityLevel;

    readonly pkgInfo: readonly PackageInfo[];

    readonly reviews: readonly ReviewInfo[];

    // The ID of the main comment so that it can be linked to by other comments
    readonly mainBotCommentID?: number;
}

export type BotResult =
    | PrInfo
    | BotError
    | BotEnsureRemovedFromProject;

function getHeadCommit(pr: PR_repository_pullRequest) {
    return pr.commits.nodes?.find(c => c?.commit.oid === pr.headRefOid)?.commit;
}

// The GQL response => Useful data for us
export async function deriveStateForPR(
    prInfo: PR_repository_pullRequest,
    fetchFile = defaultFetchFile,
    getDownloads = getMonthlyDownloadCount,
    now = new Date(),
): Promise<BotResult>  {
    if (prInfo.author == null) return botError("PR author does not exist");

    if (prInfo.isDraft) return botEnsureRemovedFromProject("PR is a draft");
    if (prInfo.state !== "OPEN") return botEnsureRemovedFromProject("PR is not active");

    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botError("No head commit found");

    const author = prInfo.author.login;
    const isFirstContribution = prInfo.authorAssociation === "FIRST_TIME_CONTRIBUTOR";

    const createdDate = new Date(prInfo.createdAt);
    // apparently `headCommit.pushedDate` can be null in some cases (see #48708), use the PR creation time for that
    // (it would be bad to use `committedDate`/`authoredDate`, since these can be set to arbitrary values)
    const lastPushDate = new Date(headCommit.pushedDate || prInfo.createdAt);
    const lastCommentDate = getLastCommentishActivityDate(prInfo);
    const blessing = getLastMaintainerBlessing(lastPushDate, prInfo.timelineItems);
    const reopenedDate = getReopenedDate(prInfo.timelineItems);
    // we should generally have all files (except for draft PRs)
    const fileCount = prInfo.changedFiles;
    // we fetch all files so this shouldn't happen, but GH has a limit of 3k files even with
    // pagination (docs.github.com/en/rest/reference/pulls#list-pull-requests-files) and in
    // that case `files.totalCount` would be 3k so it'd fit the count but `changedFiles` would
    // be correct; so to be safe: check it, and warn if there are many files (or zero)
    const tooManyFiles = !fileCount // should never happen, make it look fishy if it does
        || fileCount !== prInfo.files?.nodes?.length // didn't get all files somehow
        || fileCount > 500; // suspiciously many files
    const hugeChange = prInfo.additions + prInfo.deletions > 5000;

    const pkgInfoEtc = await getPackageInfosEtc(
        noNullish(prInfo.files?.nodes).map(f => f.path).sort(),
        prInfo.headRefOid, fetchFile, async name => await getDownloads(name, lastPushDate));
    if (pkgInfoEtc instanceof Error) return botError(pkgInfoEtc.message);
    const { pkgInfo, popularityLevel } = pkgInfoEtc;

    const reviews = getReviews(prInfo);
    const latestReview = max(reviews.map(r => r.date));
    const comments = noNullish(prInfo.comments.nodes);
    const mergeOfferDate = getMergeOfferDate(comments, prInfo.headRefOid);
    const mergeRequest = getMergeRequest(comments,
                                         pkgInfo.length === 1 ? [author, ...pkgInfo[0]!.owners] : [author],
                                         max([createdDate, reopenedDate, lastPushDate]));
    const lastActivityDate = max([createdDate, lastPushDate, lastCommentDate, blessing?.date, reopenedDate, latestReview]);
    const mainBotCommentID = getMainCommentID(comments);
    return {
        type: "info",
        now,
        pr_number: prInfo.number,
        author,
        headCommitOid: prInfo.headRefOid,
        lastPushDate, lastActivityDate,
        maintainerBlessed: blessing?.column,
        mergeOfferDate, mergeRequestDate: mergeRequest?.date, mergeRequestUser: mergeRequest?.user,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        isFirstContribution,
        tooManyFiles,
        hugeChange,
        popularityLevel,
        pkgInfo,
        reviews,
        mainBotCommentID,
        ...getCIResult(headCommit.checkSuites),
    };

    function botError(message: string): BotError {
        return { type: "error", now, message, author: prInfo.author?.login };
    }

    function botEnsureRemovedFromProject(message: string): BotEnsureRemovedFromProject {
        return { type: "remove", now, message, isDraft: prInfo.isDraft };
    }
}

/** Either: when the PR was last opened, or switched to ready from draft */
function getReopenedDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    return someLast(timelineItems.nodes, item => (
        (item.__typename === "ReopenedEvent" || item.__typename === "ReadyForReviewEvent")
        && new Date(item.createdAt)))
        || undefined;
}

function getMainCommentID(comments: PR_repository_pullRequest_comments_nodes[]) {
    const comment = comments.find(c => !authorNotBot(c) && c.body.includes("<!--typescript_bot_welcome-->"));
    if (!comment) return undefined;
    return comment.databaseId!;
}

function getLastCommentishActivityDate(prInfo: PR_repository_pullRequest) {
    const getCommentDate = (comment: { createdAt: string }) => new Date(comment.createdAt);
    const latestIssueCommentDate = noNullish(prInfo.comments.nodes)
        .filter(authorNotBot).map(getCommentDate);
    const latestReviewCommentDate = noNullish(prInfo.reviews?.nodes)
        .map(review => max(noNullish(review.comments.nodes).map(getCommentDate)));
    return max([...latestIssueCommentDate, ...latestReviewCommentDate]);
}

function getLastMaintainerBlessing(after: Date, timelineItems: PR_repository_pullRequest_timelineItems) {
    return someLast(timelineItems.nodes, item => {
        if (!(item.__typename === "MovedColumnsInProjectEvent" && authorNotBot(item))) return undefined;
        const d = new Date(item.createdAt);
        if (d <= after) return undefined;
        return { date: d, column: item.projectColumnName as ColumnName };
    }) || undefined;
}

async function getPackageInfosEtc(
    paths: string[], headId: string, fetchFile: typeof defaultFetchFile, getDownloads: typeof getMonthlyDownloadCount
): Promise<{pkgInfo: PackageInfo[], popularityLevel: PopularityLevel} | Error> {
    const infos = new Map<string|null, FileInfo[]>();
    for (const path of paths) {
        const [pkg, fileInfo] = await categorizeFile(path, async (oid: string = headId) => fetchFile(`${oid}:${path}`));
        if (!infos.has(pkg)) infos.set(pkg, []);
        infos.get(pkg)!.push(fileInfo);
    }
    const result: PackageInfo[] = [];
    let maxDownloads = 0;
    for (const [name, files] of infos) {
        const oldOwners = !name ? null : await getOwnersOfPackage(name, "master", fetchFile);
        if (oldOwners instanceof Error) return oldOwners;
        const newOwners0 = !name ? null
            : !paths.includes(`types/${name}/index.d.ts`) ? oldOwners
            : await getOwnersOfPackage(name, headId, fetchFile);
        // A header error is still an add/edit whereas a missing file is
        // delete, hence newOwners0 here
        const kind = !name ? "edit" : !oldOwners ? "add" : !newOwners0 ? "delete" : "edit";
        // treats a header error as a missing file, the CI will fail anyway
        // (maybe add a way to pass the error in the info so people don't need to read the CI?)
        const newOwners = newOwners0 instanceof Error ? null : newOwners0;
        const owners = oldOwners || [];
        const addedOwners = newOwners === null ? []
            : oldOwners === null ? newOwners
            : newOwners.filter(o => !oldOwners.includes(o));
        const deletedOwners = oldOwners === null ? []
            : newOwners === null ? []
            : oldOwners.filter(o => !newOwners.includes(o));
        // null name => infra => ensure critical (even though it's unused atm)
        const downloads = name ? await getDownloads(name) : Infinity;
        if (name && downloads > maxDownloads) maxDownloads = downloads;
        // keep the popularity level and not the downloads since that can change often
        const popularityLevel = downloadsToPopularityLevel(downloads);
        result.push({ name, kind, files, owners, addedOwners, deletedOwners, popularityLevel });
    }
    return { pkgInfo: result, popularityLevel: downloadsToPopularityLevel(maxDownloads) };
}

async function categorizeFile(path: string, contents: (oid?: string) => Promise<string | undefined>): Promise<[string|null, FileInfo]> {
    // https://regex101.com/r/eFvtrz/1
    const match = /^types\/(.*?)\/.*?[^\/](?:\.(d\.ts|tsx?|md))?$/.exec(path);
    if (!match) return [null, { path, kind: "infrastructure" }];
    const [pkg, suffix] = match.slice(1); // `suffix` can be null
    if (!pkg) return [null, { path, kind: "infrastructure" }];
    switch (suffix || "") {
        case "d.ts": return [pkg, { path, kind: "definition" }];
        case "ts": case "tsx": return [pkg, { path, kind: "test" }];
        case "md": return [pkg, { path, kind: "markdown" }];
        default: {
            const suspect = await configSuspicious(path, contents);
            return [pkg, { path, kind: suspect ? "package-meta" : "package-meta-ok", suspect }];
        }
    }
}

interface ConfigSuspicious {
    (path: string, getContents: (oid?: string) => Promise<string | undefined>): Promise<string | undefined>;
    [basename: string]: (text: string, oldText?: string) => string | undefined;
}
const configSuspicious = <ConfigSuspicious>(async (path, getContents) => {
    const basename = path.replace(/.*\//, "");
    const checker = configSuspicious[basename];
    if (!checker) return `edited`;
    const text = await getContents();
    // Removing tslint.json, tsconfig.json, package.json and
    // OTHER_FILES.txt is checked by the CI. Specifics are in my commit
    // message.
    if (text === undefined) return undefined;
    const oldText = await getContents("master");
    return checker(text, oldText);
});
configSuspicious["OTHER_FILES.txt"] = makeChecker(
    [],
    urls.otherFilesTxt,
    { parse: text => text.split(/\r?\n/) }
);
configSuspicious["package.json"] = makeChecker(
    { private: true },
    urls.packageJson,
    { ignore: data => {
        delete data.dependencies;
        delete data.types;
        delete data.typesVersions;
    } }
);
configSuspicious["tslint.json"] = makeChecker(
    { extends: "dtslint/dt.json" },
    urls.linterJson
);
configSuspicious["tsconfig.json"] = makeChecker(
    {
        compilerOptions: {
            module: "commonjs",
            lib: ["es6"],
            noImplicitAny: true,
            noImplicitThis: true,
            strictFunctionTypes: true,
            strictNullChecks: true,
            types: [],
            noEmit: true,
            forceConsistentCasingInFileNames: true,
        }
    },
    urls.tsconfigJson,
    { ignore: data => {
        data.compilerOptions.lib = data.compilerOptions.lib.filter((value: unknown) =>
            !(typeof value === "string" && value.toLowerCase() === "dom"));
        ["baseUrl", "typeRoots", "paths", "jsx"].forEach(k => delete data.compilerOptions[k]);
        if (typeof data.compilerOptions?.target === "string" && data.compilerOptions.target.toLowerCase() === "es6") {
            delete data.compilerOptions.target;
        }
        delete data.files;
    } }
);

// helper for file checkers: allow either a given "expectedForm", or any edits that get closer
// to it, ignoring some keys.  The ignored properties are in most cases checked
// elsewhere (dtslint), and in some cases they are irrelevant.
function makeChecker(expectedForm: any, expectedFormUrl: string, options?: { parse: (text: string) => unknown } | { ignore: (data: any) => void }) {
    const diffFromExpected = (text: string) => {
        let data: any;
        if (options && "parse" in options) {
            data = options.parse(text);
        } else {
            try { data = JSON.parse(text); } catch (e) { return "couldn't parse json"; }
        }
        if (options && "ignore" in options) options.ignore(data);
        try { return jsonDiff.compare(expectedForm, data); } catch (e) { return "couldn't diff json"; }
    };
    return (contents: string, oldText?: string) => {
        const theExpectedForm = `[the expected form](${expectedFormUrl})`;
        const newDiff = diffFromExpected(contents);
        if (typeof newDiff === "string") return newDiff;
        if (newDiff.length === 0) return undefined;
        const diffDescription = newDiff.every(d => /^\/[0-9]+($|\/)/.test(d.path)) ? ""
            : ` (check: ${newDiff.map(d => `\`${d.path.slice(1).replace(/\//g, ".")}\``).join(", ")})`;
        if (!oldText) return `not ${theExpectedForm}${diffDescription}`;
        const oldDiff = diffFromExpected(oldText);
        if (typeof oldDiff === "string") return oldDiff;
        if (jsonDiff.compare(oldDiff, newDiff).every(({ op }) => op === "remove")) return undefined;
        return `not ${theExpectedForm} and not moving towards it${diffDescription}`;
    };
}

function latestComment(comments: PR_repository_pullRequest_comments_nodes[]) {
    return max(comments, (r, c) => Date.parse(r.createdAt) - Date.parse(c.createdAt));
}

function getMergeOfferDate(comments: PR_repository_pullRequest_comments_nodes[], headOid: string) {
    const offer = latestComment(comments.filter(c =>
        sameUser("typescript-bot", c.author?.login || "-")
        && comment.parse(c.body)?.tag === "merge-offer"
        && c.body.includes(`(at ${abbrOid(headOid)})`)));
    return offer && new Date(offer.createdAt);
}

function getMergeRequest(comments: PR_repository_pullRequest_comments_nodes[], users: string[], sinceDate: Date) {
    const request = latestComment(comments.filter(comment =>
        users.some(u => comment.author && sameUser(u, comment.author.login))
        && comment.body.trim().toLowerCase().startsWith("ready to merge")));
    if (!request) return request;
    const date = new Date(request.createdAt);
    return date > sinceDate ? { date, user: request.author!.login  } : undefined;
}

function getReviews(prInfo: PR_repository_pullRequest) {
    if (!prInfo.reviews?.nodes) return [];
    const headCommitOid: string = prInfo.headRefOid;
    const reviews: ReviewInfo[] = [];
    // Do this in reverse order so we can detect up-to-date-reviews correctly
    for (const r of noNullish(prInfo.reviews.nodes).reverse()) {
        const [reviewer, date] = [r.author?.login, new Date(r.submittedAt)];
        // Skip nulls
        if (!(r.commit && reviewer)) continue;
        // Skip self-reviews
        if (reviewer === prInfo.author!.login) continue;
        // Only look at the most recent review per person (ignoring pending/commented)
        if (reviews.some(r => sameUser(r.reviewer, reviewer))) continue;
        // collect reviews by type
        if (r.commit.oid !== headCommitOid) {
            reviews.push({ type: "stale", reviewer, date, abbrOid: abbrOid(r.commit.oid) });
            continue;
        }
        if (r.state === "CHANGES_REQUESTED") {
            reviews.push({ type: "changereq", reviewer, date });
            continue;
        }
        if (r.state !== "APPROVED") continue;
        const isMaintainer =
            (r.authorAssociation === "MEMBER")
            || (r.authorAssociation === "OWNER");
        reviews.push({ type: "approved", reviewer, date, isMaintainer });
    }
    return reviews;
}

function getCIResult(checkSuites: PR_repository_pullRequest_commits_nodes_commit_checkSuites | null): { ciResult: CIResult, ciUrl?: string, reRunCheckSuiteIDs?: number[] } {
    const ghActionsChecks = checkSuites?.nodes?.filter(check => check?.app?.name.includes("GitHub Actions"));

    // Freakin' crypto miners ruined GitHub Actions, and now we need to manually confirm new folks can run CI
    const actionRequiredIDs = noNullish(ghActionsChecks?.map(check =>
        check?.conclusion === "ACTION_REQUIRED" ? check.databaseId : null));
    if (actionRequiredIDs.length > 0)
        return { ciResult: "action_required", reRunCheckSuiteIDs: actionRequiredIDs };

    // Now that there is more than one GitHub Actions suite, we need to get the right one, but naively fall back
    // to the first if we can't find it, mostly to prevent breaking old tests.
    const totalStatusChecks = ghActionsChecks?.find(check => check?.checkRuns?.nodes?.[0]?.title === "test") || ghActionsChecks?.[0];
    if (!totalStatusChecks) return { ciResult: "missing", ciUrl: undefined };

    switch (totalStatusChecks.conclusion) {
        case "SUCCESS":
            return { ciResult: "pass" };
        case "FAILURE":
        case "SKIPPED":
        case "TIMED_OUT":
            return { ciResult: "fail", ciUrl: totalStatusChecks.url };
        default:
            return { ciResult: "unknown" };
    }
}

function downloadsToPopularityLevel(monthlyDownloads: number): PopularityLevel {
    return monthlyDownloads > CriticalPopularityThreshold ? "Critical"
        : monthlyDownloads > NormalPopularityThreshold ? "Popular"
        : "Well-liked by everyone";
}

export async function getOwnersOfPackage(packageName: string, version: string, fetchFile: typeof defaultFetchFile): Promise<string[] | null | Error> {
    const indexDts = `${version}:types/${packageName}/index.d.ts`;
    const indexDtsContent = await fetchFile(indexDts, 10240); // grab at most 10k
    if (indexDtsContent === undefined) return null;
    let parsed: HeaderParser.Header;
    try {
        parsed = HeaderParser.parseHeaderOrFail(indexDtsContent);
    } catch (e) {
        if (e instanceof Error) return new Error(`error parsing owners: ${e.message}`);
    }
    return noNullish(parsed!.contributors.map(c => c.githubUsername));
}
