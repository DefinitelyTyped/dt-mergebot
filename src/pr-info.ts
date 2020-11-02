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
import { noNulls, notUndefined, findLast, forEachReverse, daysSince, authorNotBot } from "./util/util";
import * as HeaderParser from "definitelytyped-header-parser";
import * as jsonDiff from "fast-json-patch";
import { PullRequestState } from "./schema/graphql-global-types";

export enum ApprovalFlags {
    None = 0,
    Other = 1 << 0,
    Owner = 1 << 1,
    Maintainer = 1 << 2
}

const CriticalPopularityThreshold = 5_000_000;
const NormalPopularityThreshold = 200_000;

export type DangerLevel =
    | "ScopedAndTested"
    | "ScopedAndUntested"
    | "ScopedAndConfiguration"
    | "MultiplePackagesEdited"
    | "Infrastructure";

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

type PackageInfo = {
    name: string | null; // null => not in a package (= infra files)
    files: FileInfo[];
    owners: string[] | null; // null => not a package or new package
    addedOwners: string[],
    deletedOwners: string[],
    popularityLevel: PopularityLevel;
};

type FileKind = "test" | "definition" | "markdown" | "package-meta" | "package-meta-ok"| "infrastructure";

type FileInfo = {
    path: string,
    kind: FileKind,
    suspect?: string // reason for a file being "package-meta" rather than "package-meta-ok"
};

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
     * True if the author of the PR is already a listed owner
     */
    readonly authorIsOwner: boolean;

    /**
     * The GitHub login of the PR author
     */
    readonly author: string;

    /**
     * True if the author or an owner wants us to merge the PR
     */
    readonly mergeIsRequested: boolean;

    /**
     * The CI status of the head commit
     */
    readonly ciResult: CIResult;

    /**
     * A link to the log for the failing CI if it exists
     */
    readonly ciUrl: string | undefined;

    /**
     * True if the PR has a merge conflict
     */
    readonly hasMergeConflict: boolean;

    /**
     * The date the latest commit was pushed to GitHub
     */
    readonly lastPushDate: Date;

    /**
     * The date the anyone had a meaningful interaction with the PR
     */
    readonly lastCommentDate: Date;

    /**
     * The date of the most recent review on the head commit
     */
    readonly lastReviewDate?: Date;

    /**
     * The date the PR was last reopened by a maintainer
     */
    readonly reopenedDate?: Date;

    /**
     * A list of people who have reviewed this PR in the past, but for
     * a prior commit.
     */
    readonly reviewersWithStaleReviews: ReadonlyArray<{ reviewer: string, reviewedAbbrOid: string, date: string }>;

    /**
     * A link to the Review tab to provide reviewers with
     */
    readonly reviewLink: string;

    /**
     * True if the head commit has any failing reviews
     */
    readonly isChangesRequested: boolean;

    readonly approvalFlags: ApprovalFlags;
    readonly dangerLevel: DangerLevel;

    /**
     * Integer count of days of inactivity from the author
     */
    readonly stalenessInDays: number;

    /**
     * True if a maintainer blessed this PR
     */
    readonly maintainerBlessed: boolean;

    /**
     * True if the author has dismissed any reviews against the head commit
     */
    readonly hasDismissedReview: boolean;

    readonly isFirstContribution: boolean;

    readonly popularityLevel: PopularityLevel;

    readonly pkgInfo: readonly PackageInfo[];
}

function getHeadCommit(pr: GraphqlPullRequest) {
    return pr.commits.nodes?.filter(c => c?.commit.oid === pr.headRefOid)?.[0]?.commit;
}

// Just the networking
export async function queryPRInfo(prNumber: number) {
    return await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: prNumber
        },
        fetchPolicy: "network-only",
        fetchResults: true
    });
}

// The GQL response => Useful data for us
export async function deriveStateForPR(
    info: ApolloQueryResult<PRQueryResult>,
    fetchFile = defaultFetchFile,
    getDownloads = getMonthlyDownloadCount,
    getNow = () => new Date(),
): Promise<PrInfo | BotFail | BotError | BotEnsureRemovedFromProject>  {
    const prInfo = info.data.repository?.pullRequest;

    if (!prInfo) return botFail(`No PR with this number exists, (${JSON.stringify(info)})`);
    if (prInfo.author == null) return botError(prInfo.number, "PR author does not exist");

    if (prInfo.isDraft) return botEnsureRemovedFromProject(prInfo.number, "PR is a draft", true);
    if (prInfo.state !== PullRequestState.OPEN) return botEnsureRemovedFromProject(prInfo.number, "PR is not active", false);

    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botError(prInfo.number, "No head commit found");

    const pkgInfoEtc = await getPackageInfosEtc(
        noNulls(prInfo.files?.nodes).map(f => f.path).sort(),
        headCommit.oid, fetchFile, getDownloads);
    if (pkgInfoEtc instanceof Error) return botError(prInfo.number, pkgInfoEtc.message);
    const { pkgInfo, popularityLevel } = pkgInfoEtc;

    const allOwners = pkgInfoAllOwners(pkgInfo);

    const author = prInfo.author.login;
    const authorIsOwner = isOwner(author);

    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;

    const freshReviewsByState = partition(noNulls(prInfo.reviews?.nodes), r => r.state);
    const hasDismissedReview = !!freshReviewsByState.DISMISSED?.length;

    const createdDate = new Date(prInfo.createdAt);
    const lastPushDate = new Date(headCommit.pushedDate);
    const lastCommentDate = getLastCommentishActivityDate(prInfo.timelineItems, prInfo.reviews) || lastPushDate;
    const lastBlessing = getLastMaintainerBlessingDate(prInfo.timelineItems);
    const reopenedDate = getReopenedDate(prInfo.timelineItems);
    const now = getNow().toISOString();
    const reviewAnalysis = analyzeReviews(prInfo, isOwner);
    const activityDates = [createdDate, lastPushDate, lastCommentDate, lastBlessing, reopenedDate, reviewAnalysis.lastReviewDate];

    const dangerLevel = getDangerLevel(pkgInfo);

    return {
        type: "info",
        now,
        pr_number: prInfo.number,
        author,
        dangerLevel,
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        mergeIsRequested: !!prInfo.comments.nodes
            && usersSayReadyToMerge(noNulls(prInfo.comments.nodes),
                                    dangerLevel.startsWith("Scoped") ? [author, ...allOwners] : [author],
                                    [createdDate, lastPushDate, reopenedDate, reviewAnalysis.firstApprovalDate]),
        stalenessInDays: Math.min(...activityDates.map(date => daysSince(date || lastPushDate, now))),
        lastPushDate, reopenedDate, lastCommentDate,
        maintainerBlessed: lastBlessing ? lastBlessing.getTime() > lastPushDate.getTime() : false,
        reviewLink: `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${prInfo.number}/files`,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        authorIsOwner,
        isFirstContribution,
        popularityLevel,
        pkgInfo,
        hasDismissedReview,
        ...getCIResult(headCommit),
        ...reviewAnalysis
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

    function isOwner(login: string) {
        return allOwners.some(k => k.toLowerCase() === login.toLowerCase());
    }
}

type ReopenedEvent = PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent;
type ReadyForReviewEvent = PR_repository_pullRequest_timelineItems_nodes_ReadyForReviewEvent;

/** Either: when the PR was last opened, or switched to ready from draft */
function getReopenedDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    const lastItem = findLast(timelineItems.nodes, (item): item is ReopenedEvent | ReadyForReviewEvent => (
        item?.__typename === "ReopenedEvent" || item?.__typename === "ReadyForReviewEvent"
      ));

    return lastItem && lastItem.createdAt && new Date(lastItem.createdAt)
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
        const latestDate = [lastIssueComment.createdAt, lastReviewComment.createdAt].sort()[1]
        return new Date(latestDate);
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
    let result = [], maxDownloads = 0;
    for (const [name, files] of infos) {
        const owners = !name ? null : await getOwnersOfPackage(name, "master", fetchFile);
        const newOwners = !name ? null
            : !paths.includes(`types/${name}/index.d.ts`) ? owners
            : await getOwnersOfPackage(name, headId, fetchFile);
        if (owners instanceof Error) return owners;
        if (newOwners instanceof Error) return newOwners;
        const addedOwners = owners === null ? (newOwners || [])
            : newOwners === null ? []
            : newOwners.filter(o => !owners.includes(o));
        const deletedOwners = newOwners === null ? (owners || [])
            : owners === null ? []
            : owners.filter(o => !newOwners.includes(o));
        // null name => infra => ensure critical (even though it's unused atm)
        const downloads = name ? await getDownloads(name) : Infinity;
        if (name && downloads > maxDownloads) maxDownloads = downloads;
        // keep the popularity level and not the downloads since that can change often
        const popularityLevel = downloadsToPopularityLevel(downloads);
        result.push({ name, files, owners, addedOwners, deletedOwners, popularityLevel });
    }
    return { pkgInfo: result, popularityLevel: downloadsToPopularityLevel(maxDownloads) };
}

export function pkgInfoAllOwners(pkgInfo: readonly PackageInfo[]): string[] {
    return [...new Set(noNulls(pkgInfo.map(p => p.owners)).flat(1))];
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
    [ "dependencies", "types", "typesVersions" ]
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
    [ "files", "compilerOptions.paths", "compilerOptions.baseUrl", "compilerOptions.typeRoots" ]
);

// helper for json file testers: allow either a given "requiredForm", or any edits that get closer
// to it, ignoring some keys (sub-values can be specified using dots).  The ignored properties are
// in most cases checked elsewhere (dtslint), and in some cases they are irrelevant.
function makeJsonCheckerFromCore(requiredForm: any, ignoredKeys: string[]) {
    const diffFromReq = (text: string) => {
        let json: any;
        try { json = JSON.parse(text); } catch (e) { return "couldn't parse json"; }
        // allow dotted keys in ignoredKeys
        ignoredKeys.map(k => k.split(".")).forEach(keys =>
            delete keys.slice(0, -1).reduce((a,b) => a?.[b], json)
                   ?.[keys[keys.length - 1]]);
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

function partition<T, U extends string>(arr: ReadonlyArray<T>, sorter: (el: T) => U) {
    const res: { [K in U]?: T[] } = {};
    for (const el of arr) {
        const key = sorter(el);
        const target: T[] = res[key] ?? (res[key] = []);
        target.push(el);
    }
    return res;
}

function usersSayReadyToMerge(comments: PR_repository_pullRequest_comments_nodes[], users: string[], sinceDates: (Date|undefined)[]) {
    const sinceDate = Math.max(...sinceDates.map(date => date?.getTime() || 0));
    return comments.some(comment =>
        comment
        && users.includes(comment.author?.login || " ")
        && comment.body.trim().toLowerCase().startsWith("ready to merge")
        && (new Date(comment.createdAt)).getTime() > sinceDate);
}

function analyzeReviews(prInfo: PR_repository_pullRequest, isOwner: (name: string) => boolean) {
    const hasUpToDateReview: Set<string> = new Set();
    const headCommitOid: string = prInfo.headRefOid;
    /** Key: commit id. Value: review info. */
    const staleReviewAuthorsByCommit = new Map<string, { reviewer: string, date: string }>();
    let lastReviewDate, firstApprovalDate;
    let isChangesRequested = false;
    let approvalFlags = ApprovalFlags.None;

    // Do this in reverse order so we can detect up-to-date-reviews correctly
    const reviews = [...prInfo.reviews?.nodes ?? []].reverse();

    for (const r of reviews) {
        // Skip nulls
        if (!r?.commit || !r?.author?.login) continue;
        // Skip self-reviews
        if (r.author.login === prInfo.author!.login) continue;

        if (r.commit.oid !== headCommitOid) {
            // Stale review
            // Reviewers with reviews of the current commit are not stale
            if (!hasUpToDateReview.has(r.author.login)) {
                staleReviewAuthorsByCommit.set(r.commit.abbreviatedOid, { reviewer: r.author.login, date: r.submittedAt });
            }
        } else if (!hasUpToDateReview.has(r.author.login)) {
            // Most recent review of head commit for this author
            hasUpToDateReview.add(r.author.login);
            const reviewDate = new Date(r.submittedAt);
            lastReviewDate = lastReviewDate && lastReviewDate > reviewDate ? lastReviewDate : reviewDate;
            firstApprovalDate = firstApprovalDate && firstApprovalDate < reviewDate ? firstApprovalDate : reviewDate;
            if (r.state === PullRequestReviewState.CHANGES_REQUESTED) {
                isChangesRequested = true;
            } else if (r.state === PullRequestReviewState.APPROVED) {
                if ((r.authorAssociation === CommentAuthorAssociation.MEMBER)
                    || (r.authorAssociation === CommentAuthorAssociation.OWNER)) {
                    approvalFlags |= ApprovalFlags.Maintainer;
                } else if (isOwner(r.author.login)) {
                    approvalFlags |= ApprovalFlags.Owner;
                } else {
                    approvalFlags |= ApprovalFlags.Other;
                }
            }
        }
    }

    return ({
        lastReviewDate,
        firstApprovalDate,
        reviewersWithStaleReviews: Array.from(staleReviewAuthorsByCommit.entries()).map(([commit, info]) => ({
            reviewedAbbrOid: commit,
            reviewer: info.reviewer,
            date: info.date
        })),
        approvalFlags,
        isChangesRequested
    });
}

function getDangerLevel(pkgInfo: readonly PackageInfo[]): DangerLevel {
    if (pkgInfo.find(p => p.name === null)) return "Infrastructure";
    if (pkgInfo.length === 0) {
        throw new Error("Internal Error: not infrastructure but no packages touched too");
    }
    const nonTestPackagesTouched =
        noNulls(pkgInfo.map(p => (p.name === null || !p.files.some(f => f.kind === "test"))));
    if (nonTestPackagesTouched.length > 1) {
        return "MultiplePackagesEdited";
    } else if (pkgInfo.some(p => p.files.some(f => f.kind === "package-meta"))) {
        return "ScopedAndConfiguration";
    } else if (pkgInfo.some(p => p.files.some(f => f.kind === "test"))) {
        return "ScopedAndTested";
    } else {
        return "ScopedAndUntested";
    }
}

function getCIResult(headCommit: PR_repository_pullRequest_commits_nodes_commit) {
    let ciUrl: string | undefined = undefined;
    let ciResult: CIResult = undefined!;

    const totalStatusChecks = headCommit.checkSuites?.nodes?.find(check => check?.app?.name?.includes("GitHub Actions"))
    if (totalStatusChecks) {
        switch (totalStatusChecks.conclusion) {
            case CheckConclusionState.SUCCESS:
                ciResult = CIResult.Pass;
                break;

            case CheckConclusionState.FAILURE:
            case CheckConclusionState.SKIPPED:
            case CheckConclusionState.TIMED_OUT:
                ciResult = CIResult.Fail;
                ciUrl = totalStatusChecks.url;
                break;

            default:
                ciResult = CIResult.Pending;
                break;
        }
    }

    if (!ciResult) {
        return { ciResult: CIResult.Missing, ciUrl: undefined };
    }

    return { ciResult, ciUrl };
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
