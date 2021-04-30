import { GetPRInfo } from "./queries/pr-query";
import { PR_repository_pullRequest as GraphqlPullRequest,
         PR_repository_pullRequest,
         PR_repository_pullRequest_commits_nodes_commit_checkSuites,
         PR_repository_pullRequest_timelineItems,
         PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent,
         PR_repository_pullRequest_timelineItems_nodes_ReadyForReviewEvent,
         PR_repository_pullRequest_timelineItems_nodes_MovedColumnsInProjectEvent,
         PR_repository_pullRequest_comments_nodes,
} from "./queries/schema/PR";
import { getMonthlyDownloadCount } from "./util/npm";
import { client } from "./graphql-client";
import { fetchFile as defaultFetchFile } from "./util/fetchFile";
import { noNullish, findLast, sameUser, authorNotBot, max, abbrOid } from "./util/util";
import * as comment from "./util/comment";
import * as urls from "./urls";
import * as HeaderParser from "@definitelytyped/header-parser";
import * as jsonDiff from "fast-json-patch";

const CriticalPopularityThreshold = 5_000_000;
const NormalPopularityThreshold = 200_000;

export type PopularityLevel =
    | "Well-liked by everyone"
    | "Popular"
    | "Critical";

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
    suspect?: string, // reason for a file being "package-meta" rather than "package-meta-ok"
    suggestion?: Suggestion, // The differences from the expected form, as GitHub suggestions
};

export interface Suggestion {
    readonly startLine: number;
    readonly endLine: number;
    readonly text: string;
}

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
     * True if a maintainer blessed this PR
     */
    readonly maintainerBlessed: boolean;

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
     * True if there are more files than we can fetch from the initial query
     */
    readonly tooManyFiles: boolean;

    readonly popularityLevel: PopularityLevel;

    readonly pkgInfo: readonly PackageInfo[];

    readonly reviews: readonly ReviewInfo[];
}

export type BotResult =
    | PrInfo
    | BotError
    | BotEnsureRemovedFromProject;

function getHeadCommit(pr: GraphqlPullRequest) {
    return pr.commits.nodes?.find(c => c?.commit.oid === pr.headRefOid)?.commit;
}

// Just the networking
export async function queryPRInfo(prNumber: number) {
    // The query can return a mergeable value of `UNKNOWN`, and then it takes a
    // while to get the actual value while GH refreshes the state (verified
    // with GH that this is expected).  So implement a simple retry thing to
    // get a proper value, or return a useless one if giving up.
    let retries = 0;
    while (true) {
        const info = await client.query({
            query: GetPRInfo,
            variables: { pr_number: prNumber },
            fetchPolicy: "no-cache",
        });
        const prInfo = info.data.repository?.pullRequest;
        if (!prInfo) return info; // let `deriveStateForPR` handle the missing result
        if (!(prInfo.state === "OPEN" && prInfo.mergeable === "UNKNOWN")) return info;
        const { nodes, totalCount } = prInfo.files!;
        if (nodes!.length < totalCount) console.warn(`  *** Note: ${totalCount - nodes!.length} files were not seen by this query!`);
        if (++retries > 5) { // we already did 5 tries, so give up and...
            info.data.repository = null;
            return info; // ...return a bad result to avoid using the bogus information
        }
        // wait 3N..3N+1 seconds (based on trial runs: it usually works after one wait)
        const wait = 1000 * (Math.random() + 3 * retries);
        await new Promise(resolve => setTimeout(resolve, wait));
    }
}

interface Refs {
    readonly head: string;
    readonly master: "master";
    readonly latestSuggestions: string;
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
    const lastBlessing = getLastMaintainerBlessingDate(prInfo.timelineItems);
    const reopenedDate = getReopenedDate(prInfo.timelineItems);
    const tooManyFiles = prInfo.files?.totalCount !== prInfo.files?.nodes?.length;

    const refs = {
        head: prInfo.headRefOid,
        master: "master",
        // Exclude existing suggestions from subsequent reviews
        latestSuggestions: max(noNullish(prInfo.reviews?.nodes).filter(review => !authorNotBot(review)), (a, b) =>
            Date.parse(a.submittedAt) - Date.parse(b.submittedAt))?.commit?.oid,
    } as const;
    const pkgInfoEtc = await getPackageInfosEtc(
        noNullish(prInfo.files?.nodes).map(f => f.path).sort(),
        refs, fetchFile, async name => await getDownloads(name, lastPushDate));
    if (pkgInfoEtc instanceof Error) return botError(pkgInfoEtc.message);
    const { pkgInfo, popularityLevel } = pkgInfoEtc;

    const reviews = getReviews(prInfo);
    const latestReview = max(reviews.map(r => r.date));
    const comments = noNullish(prInfo.comments.nodes);
    const mergeOfferDate = getMergeOfferDate(comments, prInfo.headRefOid);
    const mergeRequest = getMergeRequest(comments,
                                         pkgInfo.length === 1 ? [author, ...pkgInfo[0]!.owners] : [author],
                                         max([createdDate, reopenedDate, lastPushDate]));
    const lastActivityDate = max([createdDate, lastPushDate, lastCommentDate, lastBlessing, reopenedDate, latestReview]);

    return {
        type: "info",
        now,
        pr_number: prInfo.number,
        author,
        headCommitOid: prInfo.headRefOid,
        lastPushDate, lastActivityDate,
        maintainerBlessed: lastBlessing ? lastBlessing > lastPushDate : false,
        mergeOfferDate, mergeRequestDate: mergeRequest?.date, mergeRequestUser: mergeRequest?.user,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        isFirstContribution,
        tooManyFiles,
        popularityLevel,
        pkgInfo,
        reviews,
        ...getCIResult(headCommit.checkSuites),
    };

    function botError(message: string): BotError {
        return { type: "error", now, message, author: prInfo.author?.login };
    }

    function botEnsureRemovedFromProject(message: string): BotEnsureRemovedFromProject {
        return { type: "remove", now, message, isDraft: prInfo.isDraft };
    }
}

type ReopenedEvent = PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent;
type ReadyForReviewEvent = PR_repository_pullRequest_timelineItems_nodes_ReadyForReviewEvent;

/** Either: when the PR was last opened, or switched to ready from draft */
function getReopenedDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    const lastItem = findLast(timelineItems.nodes, (item): item is ReopenedEvent | ReadyForReviewEvent => (
        item?.__typename === "ReopenedEvent" || item?.__typename === "ReadyForReviewEvent"
    ));

    return lastItem?.createdAt && new Date(lastItem.createdAt);
}

function getLastCommentishActivityDate(prInfo: PR_repository_pullRequest) {
    const getCommentDate = (comment: { createdAt: string }) => new Date(comment.createdAt);
    const latestIssueCommentDate = noNullish(prInfo.comments.nodes)
        .filter(authorNotBot).map(getCommentDate);
    const latestReviewCommentDate = noNullish(prInfo.reviews?.nodes)
        .map(review => max(noNullish(review.comments.nodes).map(getCommentDate)));
    return max([...latestIssueCommentDate, ...latestReviewCommentDate]);
}

type MovedColumnsInProjectEvent = PR_repository_pullRequest_timelineItems_nodes_MovedColumnsInProjectEvent;
function getLastMaintainerBlessingDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    const lastColumnChange = findLast(timelineItems.nodes, (item): item is MovedColumnsInProjectEvent =>
        item?.__typename === "MovedColumnsInProjectEvent" && authorNotBot(item!));
    // ------------------------------ TODO ------------------------------
    // Should add and use the `previousProjectColumnName` field to
    // verify that the move was away from "Needs Maintainer Review", but
    // that is still in beta ATM.
    // ------------------------------ TODO ------------------------------
    if (lastColumnChange) {
        return new Date(lastColumnChange.createdAt);
    }
    return undefined;
}

async function getPackageInfosEtc(
    paths: string[], refs: Refs, fetchFile: typeof defaultFetchFile, getDownloads: typeof getMonthlyDownloadCount
): Promise<{pkgInfo: PackageInfo[], popularityLevel: PopularityLevel} | Error> {
    const infos = new Map<string|null, FileInfo[]>();
    for (const path of paths) {
        const [pkg, fileInfo] = await categorizeFile(path, async ref => fetchFile(`${refs[ref]}:${path}`));
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
            : await getOwnersOfPackage(name, refs.head, fetchFile);
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

type GetContents = (ref: keyof Refs) => Promise<string | undefined>;

async function categorizeFile(path: string, getContents: GetContents): Promise<[string|null, FileInfo]> {
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
            const suspect = await configSuspicious(path, getContents);
            return [pkg, { path, kind: suspect ? "package-meta" : "package-meta-ok", ...suspect }];
        }
    }
}

interface ConfigSuspicious {
    (path: string, getContents: GetContents): Promise<{ suspect: string, sugestion?: Suggestion } | undefined>;
    [basename: string]: (newText: string, getContents: GetContents) => Promise<{ suspect: string, suggestion?: Suggestion } | undefined>;
}
const configSuspicious = <ConfigSuspicious>(async (path, getContents) => {
    const basename = path.replace(/.*\//, "");
    const checker = configSuspicious[basename];
    if (!checker) return { suspect: `edited` };
    const newText = await getContents("head");
    // Removing tslint.json, tsconfig.json, package.json and
    // OTHER_FILES.txt is checked by the CI. Specifics are in my commit
    // message.
    if (newText === undefined) return undefined;
    return checker(newText, getContents);
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
        data.compilerOptions.lib = data.compilerOptions.lib.filter((value: unknown) => value !== "dom");
        delete data.compilerOptions.baseUrl;
        delete data.compilerOptions.typeRoots;
        delete data.compilerOptions.paths;
        delete data.files;
    } }
);

// helper for file checkers: allow either a given "expectedForm", or any edits that get closer
// to it, ignoring some keys.  The ignored properties are in most cases checked
// elsewhere (dtslint), and in some cases they are irrelevant.
function makeChecker(expectedForm: any, expectedFormUrl: string, options?: { parse: (text: string) => unknown } | { ignore: (data: any) => void }) {
    return async (newText: string, getContents: GetContents) => {
        let suggestion: any;
        if (options && "parse" in options) {
            suggestion = options.parse(newText);
        } else {
            try { suggestion = JSON.parse(newText); } catch (e) { if (e instanceof SyntaxError) return { suspect: `couldn't parse json: ${e.message}` }; }
        }
        const newData = jsonDiff.deepClone(suggestion);
        if (options && "ignore" in options) options.ignore(newData);
        const towardsIt = jsonDiff.deepClone(expectedForm);
        // Getting closer to the expected form relative to master isn't
        // suspect
        const vsMaster = await ignoreExistingDiffs("master");
        if (!vsMaster) return undefined;
        if (vsMaster.done) return { suspect: vsMaster.suspect };
        // whereas getting closer relative to existing suggestions means
        // no new suggestions
        if (!await ignoreExistingDiffs("latestSuggestions")) return { suspect: vsMaster.suspect };
        jsonDiff.applyPatch(suggestion, jsonDiff.compare(newData, towardsIt));
        return {
            suspect: vsMaster.suspect,
            suggestion: makeSuggestion(),
        };

        // Apply any preexisting diffs to towardsIt
        async function ignoreExistingDiffs(ref: keyof Refs) {
            const theExpectedForm = `[the expected form](${expectedFormUrl})`;
            const diffFromExpected = (data: any) => jsonDiff.compare(towardsIt, data);
            const newDiff = diffFromExpected(newData);
            if (newDiff.length === 0) return undefined;
            const oldText = await getContents(ref);
            if (!oldText) return { suspect: `not ${theExpectedForm}` };
            let oldData;
            if (options && "parse" in options) {
                oldData = options.parse(oldText);
            } else {
                try { oldData = JSON.parse(oldText); } catch (e) { if (e instanceof SyntaxError) return { done: true, suspect: `couldn't parse json: ${e.message}` }; }
            }
            if (options && "ignore" in options) options.ignore(oldData);
            const oldDiff = diffFromExpected(oldData);
            const notRemove = jsonDiff.compare(oldDiff, newDiff).filter(({ op }) => op !== "remove");
            if (notRemove.length === 0) return undefined;
            jsonDiff.applyPatch(newDiff, notRemove.map(({ path }) => ({ op: "remove", path })));
            jsonDiff.applyPatch(towardsIt, newDiff.filter(({ op }: { op?: typeof newDiff[number]["op"] }) => op));
            return { suspect: `not ${theExpectedForm} and not moving towards it` };
        }

        // Suggest the different lines to the author
        function makeSuggestion() {
            const text = JSON.stringify(suggestion, undefined, 4);
            const suggestionLines = Object.keys(suggestion).length === 1
                ? [text.replace(/\n */g, " ") + "\n"]
                : (text + "\n").split(/^/m);
            // "^" will match inside LineTerminatorSequence so
            // "\r\n".split(/^/m) is two lines. Sigh.
            // https://tc39.es/ecma262/#_ref_7303:~:text=the%20character%20Input%5Be%20%2D%201%5D%20is%20one%20of%20LineTerminator
            const lines = newText.replace(/\r\n/g, "\n").split(/^/m);
            // When suggestionLines is empty, that suggests removing all
            // of the different lines
            let startLine = 1;
            while (suggestionLines[0]?.trim() === lines[startLine - 1]?.trim()) {
                suggestionLines.shift();
                startLine++;
            }
            let endLine = lines.length;
            while (suggestionLines[suggestionLines.length - 1]?.trim() === lines[endLine - 1]?.trim()) {
                suggestionLines.pop();
                endLine--;
            }
            return {
                startLine,
                endLine,
                text: suggestionLines.join(""),
            };
        }
    };
}

function latestComment(comments: PR_repository_pullRequest_comments_nodes[]) {
    return max(comments, (r, c) => Date.parse(r.createdAt) - Date.parse(c.createdAt));
}

function getMergeOfferDate(comments: PR_repository_pullRequest_comments_nodes[], headOid: string) {
    const offer = latestComment(comments.filter(c =>
        !authorNotBot(c)
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

async function getOwnersOfPackage(packageName: string, version: string, fetchFile: typeof defaultFetchFile): Promise<string[] | null | Error> {
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
