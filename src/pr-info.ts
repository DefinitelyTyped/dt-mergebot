import { GetPRInfo } from "./queries/pr-query";
import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest,
         PR_repository_pullRequest_commits_nodes_commit,
         PR_repository_pullRequest,
         PR_repository_pullRequest_timelineItems,
         PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent,
         PR_repository_pullRequest_reviews,
         PR_repository_pullRequest_timelineItems_nodes_IssueComment,
         PR_repository_pullRequest_timelineItems_nodes_ReadyForReviewEvent,
         PR_repository_pullRequest_timelineItems_nodes_MovedColumnsInProjectEvent,
         PR_repository_pullRequest_comments_nodes
       } from "./queries/schema/PR";
import { CIResult } from "./util/CIResult";
import { PullRequestReviewState, CommentAuthorAssociation, CheckConclusionState } from "./queries/graphql-global-types";
import { getMonthlyDownloadCount } from "./util/npm";
import { client } from "./graphql-client";
import { ApolloQueryResult } from "apollo-boost";
import { fetchFile as defaultFetchFile } from "./util/fetchFile";
import { noNulls, notUndefined, findLast, forEachReverse, sameUser, authorNotBot, latestDate } from "./util/util";
import * as comment from "./util/comment";
import * as HeaderParser from "definitelytyped-header-parser";
import * as jsonDiff from "fast-json-patch";
import { PullRequestState } from "./schema/graphql-global-types";

const CriticalPopularityThreshold = 5_000_000;
const NormalPopularityThreshold = 200_000;

export type PopularityLevel =
    | "Well-liked by everyone"
    | "Popular"
    | "Critical";

// Complete failure, won't be passed to `process` (no PR found)
export interface BotFail {
    readonly type: "fail";
    readonly message: string;
}

// Some error found, will be passed to `process` to report in a comment
export interface BotError {
    readonly type: "error";
    readonly pr_number: number;
    readonly message: string;
    readonly author: string | undefined;
}

export interface BotEnsureRemovedFromProject {
    readonly type: "remove";
    readonly pr_number: number;
    readonly message: string;
    readonly isDraft: boolean;
}

export interface BotNoPackages {
    readonly type: "no_packages";
    readonly pr_number: number;
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

export interface PrInfo {
    readonly type: "info";

    /** ISO8601 date string for the time the PR info was created at */
    readonly now: string;

    readonly pr_number: number;

    /**
     * The head commit of this PR (full format)
     */
    readonly headCommitOid: string;

    /**
     * The head commit of this PR (abbreviated format)
     */
    readonly headCommitAbbrOid: string;

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

    readonly popularityLevel: PopularityLevel;

    readonly pkgInfo: readonly PackageInfo[];

    readonly reviews: readonly ReviewInfo[];
}

function getHeadCommit(pr: GraphqlPullRequest) {
    return pr.commits.nodes?.filter(c => c?.commit.oid === pr.headRefOid)?.[0]?.commit;
}

// Just the networking
export async function queryPRInfo(prNumber: number) {
    // The query can return a mergeable value of `UNKNOWN`, and then it takes a
    // while to get the actual value while GH refreshes the state (verified
    // with GH that this is expected).  So implement a simple retry thing to
    // get a proper value, or return a useless one if giving up.
    let retries = 0;
    while (true) {
        const info = await client.query<PRQueryResult>({
            query: GetPRInfo,
            variables: { pr_number: prNumber },
            fetchPolicy: "network-only",
            fetchResults: true
        });
        const prInfo = info.data.repository?.pullRequest;
        if (!prInfo) return info; // let `deriveStateForPR` handle the missing result
        if (prInfo.mergeable !== "UNKNOWN") return info;
        if (++retries > 5) { // we already did 5 tries, so give up and...
            info.data.repository = null;
            return info; // ...return a bad result to avoid using the bogus information
        }
        // wait 3N..3N+1 seconds (based on trial runs: it usually works after one wait)
        const wait = 1000 * (Math.random() + 3 * retries);
        await new Promise(resolve => setTimeout(resolve, wait));
    }
}

// The GQL response => Useful data for us
export async function deriveStateForPR(
    info: ApolloQueryResult<PRQueryResult>,
    fetchFile = defaultFetchFile,
    getDownloads = getMonthlyDownloadCount,
    getNow = () => new Date(),
): Promise<PrInfo | BotFail | BotError | BotEnsureRemovedFromProject | BotNoPackages>  {
    const prInfo = info.data.repository?.pullRequest;

    if (!prInfo) return botFail(`No PR with this number exists, (${JSON.stringify(info)})`);
    if (prInfo.author == null) return botError(prInfo.number, "PR author does not exist");

    if (prInfo.isDraft) return botEnsureRemovedFromProject(prInfo.number, "PR is a draft", true);
    if (prInfo.state !== PullRequestState.OPEN) return botEnsureRemovedFromProject(prInfo.number, "PR is not active", false);

    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botError(prInfo.number, "No head commit found");

    const author = prInfo.author.login;
    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;

    const createdDate = new Date(prInfo.createdAt);
    // apparently `headCommit.pushedDate` can be null in some cases (see #48708), use the PR creation time for that
    // (it would be bad to use `committedDate`/`authoredDate`, since these can be set to arbitrary values)
    const lastPushDate = new Date(headCommit.pushedDate || prInfo.createdAt);
    const lastCommentDate = getLastCommentishActivityDate(prInfo.timelineItems, prInfo.reviews) || lastPushDate;
    const lastBlessing = getLastMaintainerBlessingDate(prInfo.timelineItems);
    const reopenedDate = getReopenedDate(prInfo.timelineItems);

    const pkgInfoEtc = await getPackageInfosEtc(
        noNulls(prInfo.files?.nodes).map(f => f.path).sort(),
        headCommit.oid, fetchFile, async name => await getDownloads(name, lastPushDate));
    if (pkgInfoEtc instanceof Error) return botError(prInfo.number, pkgInfoEtc.message);
    const { pkgInfo, popularityLevel } = pkgInfoEtc;
    if (!pkgInfo.some(p => p.name)) return botNoPackages(prInfo.number);

    const now = getNow().toISOString();
    const reviews = getReviews(prInfo);
    const latestReview = latestDate(...reviews.map(r => r.date));
    const comments = noNulls(prInfo.comments.nodes || []);
    const mergeOfferDate = getMergeOfferDate(comments, headCommit.abbreviatedOid);
    const mergeRequest = getMergeRequest(comments,
                                         pkgInfo.length === 1 ? [author, ...pkgInfo[0].owners] : [author],
                                         latestDate(createdDate, reopenedDate, lastPushDate)!);
    const lastActivityDate = latestDate(createdDate, lastPushDate, lastCommentDate, lastBlessing, reopenedDate, latestReview)!;

    return {
        type: "info",
        now,
        pr_number: prInfo.number,
        author,
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        lastPushDate, lastActivityDate,
        maintainerBlessed: lastBlessing ? lastBlessing > lastPushDate : false,
        mergeOfferDate, mergeRequestDate: mergeRequest?.date, mergeRequestUser: mergeRequest?.user,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        isFirstContribution,
        popularityLevel,
        pkgInfo,
        reviews,
        ...getCIResult(headCommit)
    };

    function botFail(message: string): BotFail {
        return { type: "fail", message };
    }

    function botError(pr_number: number, message: string): BotError {
        return { type: "error", message, pr_number, author: prInfo?.author?.login };
    }

    function botEnsureRemovedFromProject(pr_number: number, message: string, isDraft: boolean): BotEnsureRemovedFromProject {
        return { type: "remove", pr_number, message, isDraft };
    }

    function botNoPackages(pr_number: number): BotNoPackages {
        return { type: "no_packages", pr_number };
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

type IssueComment = PR_repository_pullRequest_timelineItems_nodes_IssueComment;
function getLastCommentishActivityDate(timelineItems: PR_repository_pullRequest_timelineItems, reviews: PR_repository_pullRequest_reviews | null) {

    const lastIssueComment = findLast(timelineItems.nodes, (item): item is IssueComment => {
        return item?.__typename === "IssueComment" && authorNotBot(item!);
    });
    const lastReviewComment = forEachReverse(reviews?.nodes, review => {
        return findLast(review?.comments?.nodes, comment => !!comment?.author?.login)
    });

    if (lastIssueComment && lastReviewComment) {
        return latestDate(new Date(lastIssueComment.createdAt), new Date(lastReviewComment.createdAt));
    }
    if (lastIssueComment || lastReviewComment) {
        return new Date((lastIssueComment || lastReviewComment)?.createdAt);
    }
    return undefined;
}

type MovedColumnsInProjectEvent = PR_repository_pullRequest_timelineItems_nodes_MovedColumnsInProjectEvent;
function getLastMaintainerBlessingDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    const lastColumnChange = findLast(timelineItems.nodes, (item): item is MovedColumnsInProjectEvent => {
        return item?.__typename === "MovedColumnsInProjectEvent" && authorNotBot(item!);
    });
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
    paths: string[], headId: string, fetchFile: typeof defaultFetchFile, getDownloads: typeof getMonthlyDownloadCount
): Promise<{pkgInfo: PackageInfo[], popularityLevel: PopularityLevel} | Error> {
    const infos = new Map<string|null, FileInfo[]>();
    for (const path of paths) {
        const [pkg, fileInfo] = await categorizeFile(path, async (oid: string = headId) => fetchFile(`${oid}:${path}`));
        if (!infos.has(pkg)) infos.set(pkg, []);
        infos.get(pkg)!.push(fileInfo);
    }
    let result: PackageInfo[] = [], maxDownloads = 0;
    for (const [name, files] of infos) {
        const oldOwners = !name ? null : await getOwnersOfPackage(name, "master", fetchFile);
        const newOwners = !name ? null
            : !paths.includes(`types/${name}/index.d.ts`) ? oldOwners
            : await getOwnersOfPackage(name, headId, fetchFile);
        if (oldOwners instanceof Error) return oldOwners;
        if (newOwners instanceof Error) return newOwners;
        if (name && !oldOwners && !newOwners) return new Error("could not get either old or new owners");
        const kind = !name ? "edit" : oldOwners && newOwners ? "edit" : newOwners ? "add" : "delete";
        const owners = oldOwners || [];
        const addedOwners = oldOwners === null ? (newOwners || [])
            : newOwners === null ? []
            : newOwners.filter(o => !oldOwners.includes(o));
        const deletedOwners = newOwners === null ? owners
            : oldOwners === null ? []
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
    switch (suffix || "") {
        case "d.ts": return [pkg, { path, kind: "definition" }];
        case "ts": case "tsx": return [pkg, { path, kind: "test" }];
        case "md": return [pkg, { path, kind: "markdown" }];
        default:
            const suspect = await configSuspicious(path, contents);
            return [pkg, { path, kind: suspect ? "package-meta" : "package-meta-ok", suspect }];
    }
}

interface ConfigSuspicious {
    (path: string, getContents: (oid?: string) => Promise<string | undefined>): Promise<string | undefined>;
    [basename: string]: (text: string, oldText?: string) => string | undefined;
};
const configSuspicious = <ConfigSuspicious>(async (path, getContents) => {
    const basename = path.replace(/.*\//, "");
    if (!(basename in configSuspicious)) return `edited`;
    const text = await getContents();
    if (text === undefined) return `couldn't fetch contents`;
    const tester = configSuspicious[basename];
    let suspect: string | undefined;
    if (tester.length === 1) {
        suspect = tester(text);
    } else {
        const oldText = await getContents("master");
        suspect = tester(text, oldText);
    }
    return suspect;
});
configSuspicious["OTHER_FILES.txt"] = contents =>
    // not empty
    (contents.length === 0) ? "empty"
    : undefined;
configSuspicious["package.json"] = makeJsonCheckerFromCore(
    { private: true },
    [ "/dependencies", "/types", "/typesVersions" ]
);
configSuspicious["tslint.json"] = makeJsonCheckerFromCore(
    { extends: "dtslint/dt.json" },
    []
);
configSuspicious["tsconfig.json"] = makeJsonCheckerFromCore(
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
            forceConsistentCasingInFileNames: true
        }
    },
    [ "/files", "/compilerOptions/paths", "/compilerOptions/baseUrl", "/compilerOptions/typeRoots" ]
);

// helper for json file testers: allow either a given "requiredForm", or any edits that get closer
// to it, ignoring some keys (JSON Patch paths).  The ignored properties are in most cases checked
// elsewhere (dtslint), and in some cases they are irrelevant.
function makeJsonCheckerFromCore(requiredForm: any, ignoredKeys: string[]) {
    const diffFromReq = (text: string) => {
        let json: any;
        try { json = JSON.parse(text); } catch (e) { return "couldn't parse json"; }
        jsonDiff.applyPatch(json, ignoredKeys.map(path => ({ op: "remove", path })));
        try { return jsonDiff.compare(requiredForm, json); } catch (e) { return "couldn't diff json" };
    };
    return (contents: string, oldText?: string) => {
        const newDiff = diffFromReq(contents);
        if (typeof newDiff === "string") return newDiff;
        if (newDiff.length === 0) return undefined;
        if (!oldText) return "not the required form";
        const oldDiff = diffFromReq(oldText);
        if (typeof oldDiff === "string") return oldDiff;
        if (jsonDiff.compare(oldDiff, newDiff).every(({ op }) => op === "remove")) return undefined;
        return "not the required form and not moving towards it";
    };
}

function latestComment(comments: PR_repository_pullRequest_comments_nodes[]) {
    if (comments.length === 0) return undefined;
    return comments.reduce((r, c) => r && Date.parse(r.createdAt) > Date.parse(c.createdAt) ? r : c);
}

function getMergeOfferDate(comments: PR_repository_pullRequest_comments_nodes[], abbrOid: string) {
    const offer = latestComment(comments.filter(c =>
        sameUser("typescript-bot", c.author?.login || "-")
        && comment.parse(c.body)?.tag === "merge-offer"
        && c.body.includes(`(at ${abbrOid})`)));
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
    for (const r of noNulls(prInfo.reviews.nodes).reverse()) {
        const [reviewer, date] = [r?.author?.login, new Date(r.submittedAt)];
        // Skip nulls
        if (!(r?.commit && reviewer)) continue;
        // Skip self-reviews
        if (reviewer === prInfo.author!.login) continue;
        // Only look at the most recent review per person (ignoring pending/commented)
        if (reviews.find(r => sameUser(r.reviewer, reviewer))) continue;
        // collect reviews by type
        if (r.commit.oid !== headCommitOid) {
            reviews.push({ type: "stale", reviewer, date, abbrOid: r.commit.abbreviatedOid });
            continue;
        }
        if (r.state === PullRequestReviewState.CHANGES_REQUESTED) {
            reviews.push({ type: "changereq", reviewer, date });
            continue;
        }
        if (r.state !== PullRequestReviewState.APPROVED) continue;
        const isMaintainer =
            (r.authorAssociation === CommentAuthorAssociation.MEMBER)
            || (r.authorAssociation === CommentAuthorAssociation.OWNER);
        reviews.push({ type: "approved", reviewer, date, isMaintainer });
    }
    return reviews;
}

function getCIResult(headCommit: PR_repository_pullRequest_commits_nodes_commit): { ciResult: CIResult, ciUrl?: string } {
    const totalStatusChecks = headCommit.checkSuites?.nodes?.find(check => check?.app?.name?.includes("GitHub Actions"));
    if (!totalStatusChecks) return { ciResult: CIResult.Missing, ciUrl: undefined };
    switch (totalStatusChecks.conclusion) {
        case CheckConclusionState.SUCCESS:
            return { ciResult: CIResult.Pass };
        case CheckConclusionState.FAILURE:
        case CheckConclusionState.SKIPPED:
        case CheckConclusionState.TIMED_OUT:
            return { ciResult: CIResult.Fail, ciUrl: totalStatusChecks.url };
        default:
            return { ciResult: CIResult.Pending };
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
    return parsed!.contributors.map(c => c.githubUsername).filter(notUndefined);
}
