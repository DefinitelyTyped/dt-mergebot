import { GetPRInfo } from "./pr-query";

import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest, PR_repository_pullRequest_commits_nodes_commit, PR_repository_pullRequest } from "./schema/PR";

import { GetFileContent, GetFileExists } from "./file-query";
import { GetFileExists  as GetFileExistsResult } from "./schema/GetFileExists";
import { GetFileContent as GetFileContentResult } from "./schema/GetFileContent";
import * as HeaderPaser from "definitelytyped-header-parser";

import moment = require("moment");

import { Opinion, Review } from "./reviews";
import { TravisResult } from "./util/travis";
import { StatusState, PullRequestReviewState, CommentAuthorAssociation, CheckConclusionState } from "./schema/graphql-global-types";
import { getMonthlyDownloadCount } from "./util/npm";
import { client } from "./graphql-client";
import { ApolloQueryResult } from "apollo-boost";
import { getOwnersOfPackages } from "./util/getOwnersOfPackages";

const MyName = "typescript-bot";

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
    | "NewDefinition"
    | "MultiplePackagesEdited"
    | "Infrastructure";

export type PopularityLevel = 
    | "Well-liked by everyone"
    | "Popular"
    | "Critical";

export interface BotFail {
    readonly type: "fail";
    readonly message: string;
}

export interface PrInfo {
    readonly type: "info";

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
     * The current list of owners of packages affected by this PR
     */
    readonly owners: readonly string[];

    /**
     * True if the author wants us to merge the PR
     */
    readonly mergeIsRequested: boolean;

    /**
     * The CI status of the head commit
     */
    readonly travisResult: TravisResult;

    /**
     * A link to the log for the failing CI if it exists
     */
    readonly travisUrl: string | undefined;

    /**
     * True if the PR has a merge conflict
     */
    readonly hasMergeConflict: boolean;

    /**
     * The date the latest commit was pushed to GitHub
     */
    readonly lastCommitDate: Date;

    /**
     * A list of people who have reviewed this PR in the past, but for
     * a prior commit.
     */
    readonly reviewersWithStaleReviews: ReadonlyArray<{ reviewer: string, reviewedAbbrOid: string }>;

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

    readonly ownerApprovalCount: number;
    readonly otherApprovalCount: number;
    readonly maintainerApprovalCount: number;

    /**
     * Integer count of days of inactivity from the author
     */
    readonly stalenessInDays: number;
    readonly anyPackageIsNew: boolean;

    /**
     * True if the author has dismissed any reviews against the head commit
     */
    readonly hasDismissedReview: boolean;
    readonly isFirstContribution: boolean;

    readonly popularityLevel: PopularityLevel;

    readonly packages: readonly string[];
    readonly files: readonly FileLocation[];
}

function getHeadCommit(pr: GraphqlPullRequest) {
    const headCommit = pr.commits.nodes?.filter(c => c?.commit.oid === pr.headRefOid) ?.[0]?.commit;
    return headCommit;
}


export async function getPRInfo(prNumber: number): Promise<PrInfo | BotFail> {
    const info = await queryPRInfo(prNumber);
    const result =  await deriveStateForPR(info);
    return result;
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

// The GQL response -> Useful data for us
export async function deriveStateForPR(info: ApolloQueryResult<PRQueryResult>): Promise<PrInfo | BotFail>  {
    const prInfo = info.data.repository?.pullRequest;
    // console.log(JSON.stringify(prInfo, undefined, 2));
    
    if (!prInfo) return botFail("No PR with this number exists");
    if (prInfo.author == null) return botFail("PR author does not exist");
    
    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botFail("No head commit");
    
    const categorizedFiles = noNulls(prInfo.files?.nodes).map(f => categorizeFile(f.path));
    const packages = getPackagesTouched(categorizedFiles);
    
    const { anyPackageIsNew, allOwners } = await getOwnersOfPackages(packages);
    const owners = Array.from(allOwners.keys());
    const authorIsOwner = isOwner(prInfo.author.login);
    
    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;
    
    const reviews = partition(prInfo.reviews?.nodes ?? [], e => e?.commit?.oid === headCommit.oid ? "fresh" : "stale");
    const freshReviewsByState = partition(noNulls(prInfo.reviews?.nodes), r => r.state);
    // const rejections = noNulls(freshReviewsByState.CHANGES_REQUESTED);
    const approvals = noNulls(freshReviewsByState.APPROVED);
    const hasDismissedReview = !!freshReviewsByState.DISMISSED?.length;
    const approvalsByRole = partition(approvals, review => {
        if (review?.author?.login === prInfo.author?.login) {
            return "self";
        }
        if (review?.authorAssociation === "OWNER" || review?.authorAssociation === "MEMBER") {
            // DefinitelyTyped maintainer
            return "maintainer";
        }
        if (owners.indexOf(review?.author?.login || "") >= 0) {
            // Known package owner
            return "owner";
        }
        return "other";
    });
    
    
    return {
        type: "info",
        pr_number: prInfo.number,
        author: prInfo.author.login,
        owners,
        dangerLevel: getDangerLevel(categorizedFiles),
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        mergeIsRequested: authorSaysReadyToMerge(prInfo),
        stalenessInDays: Math.floor(moment().diff(moment(headCommit.pushedDate), "days")),
        lastCommitDate: new Date(headCommit.pushedDate),
        reviewLink: `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${prInfo.number}/files`,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        authorIsOwner, isFirstContribution,
        popularityLevel: await getPopularityLevel(packages),
        anyPackageIsNew,
        packages,
        files: categorizedFiles,
        otherApprovalCount: approvalsByRole.other?.length ?? 0,
        ownerApprovalCount: approvalsByRole.owner?.length ?? 0,
        maintainerApprovalCount: approvalsByRole.maintainer?.length ?? 0,
        hasDismissedReview,
        ...getTravisResult(headCommit),
        ...analyzeReviews(prInfo, isOwner)
    };
    
    function botFail(message: string): BotFail {
        debugger;
        return { type: "fail", message };
    }
    
    function isOwner(login: string) {
        return owners.some(k => k.toLowerCase() === login.toLowerCase());
    }

}

type FileLocation = ({
    kind: "test",
    package: string
} | {
    kind: "definition",
    package: string
} | {
    kind: "package-meta",
    package: string
} | {
    kind: "infrastructure"
}) & { filePath: string };


async function fileExists(filename: string): Promise<boolean> {
    const info = await client.query<GetFileExistsResult>({
        query: GetFileExists,
        variables: {
            name: "DefinitelyTyped",
            owner: "DefinitelyTyped",
            expr: `master:${filename}`
        }
    });
    if (info.data.repository?.object?.__typename === "Blob") {
        return !!(info.data.repository?.object?.id);
    }
    return false;
}

async function fetchFile(expr: string): Promise<string | undefined> {
    const info = await client.query<GetFileContentResult>({
        query: GetFileContent,
        variables: {
            name: "DefinitelyTyped",
            owner: "DefinitelyTyped",
            expr: `${expr}`
        }
    });

    if (info.data.repository?.object?.__typename === "Blob") {
        return info.data.repository.object.text ?? undefined;
    }
    return undefined;
}

function categorizeFile(filePath: string): FileLocation {
    const typeDefinitionFile = /^types\/([^\/]+)\/(.*)\.d\.ts$/i;
    const typeTestFile = /^types\/([^\/]+)\/(.*)\.ts$/i;
    const typeOtherFile = /^types\/([^\/]+)\/(.*)$/i;
    let match;
    if (match = typeDefinitionFile.exec(filePath)) {
        return { filePath, kind: "definition", package: match[1] };
    } else if (match = typeTestFile.exec(filePath)) {
        return { filePath, kind: "test", package: match[1] };
    } else if (match = typeOtherFile.exec(filePath)) {
        return { filePath, kind: "package-meta", package: match[1] };
    } else {
        return { filePath, kind: "infrastructure" };
    }
}

export function getPackagesTouched(files: readonly FileLocation[]) {
    const list: string[] = [];
    for (const f of files) {
        if ("package" in f) {
            if (list.indexOf(f.package) < 0) {
                list.push(f.package);
            }
        }
    }
    return list;
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

function noNulls<T>(arr: ReadonlyArray<T | null | undefined> | null | undefined): T[] {
    if (arr == null) return [];

    return arr.filter(arr => arr != null) as T[];
}

function hasApprovalAndNoRejection(reviews: ReadonlyArray<Review>, filter: (r: Review) => boolean): boolean {
    let approve = false;
    for (const review of reviews) {
        if (!filter(review)) {
            continue;
        }
        switch (review.verdict) {
            case Opinion.Approve:
                approve = true;
                break;
            case Opinion.Reject:
                return false;
        }
    }
    return approve;
}

function addDays(date: Date, days: number): Date {
    return moment(date).add(days, "days").toDate();
}

function authorSaysReadyToMerge(info: PR_repository_pullRequest) {
    return info.comments.nodes?.some(comment => {
        if (comment?.author?.login === info.author?.login) {
            if (comment?.body.trim().toLowerCase() === "ready to merge") {
                return true;
            }
        }
        return false;
    }) ?? false;
}

function analyzeReviews(prInfo: PR_repository_pullRequest, isOwner: (name: string) => boolean) {
    const hasUpToDateReview: Set<string> = new Set();
    const headCommitOid: string = prInfo.headRefOid;
    const reviewersWithStaleReviews: { reviewer: string, reviewedAbbrOid: string }[] = [];
    let isChangesRequested = false;
    let approvalFlags = ApprovalFlags.None;
    
    // Do this in reverse order so we can detect up-to-date-reviews correctly
    const reviews = [...prInfo.reviews?.nodes ?? []].reverse();

    for (const r of reviews) {
        // Skip nulls
        if (!r?.commit || !r?.author?.login) continue;
        // Skip self-reviews
        if (r.author.login === prInfo.author!.login) continue;

        if (r.commit.oid === headCommitOid) {
            // Review of head commit
            hasUpToDateReview.add(r.author.login);
            if (r.state === PullRequestReviewState.CHANGES_REQUESTED) {
                isChangesRequested = true;
            } else if (r.state === PullRequestReviewState.APPROVED) {
                if ((r.authorAssociation === CommentAuthorAssociation.MEMBER) || (r.authorAssociation === CommentAuthorAssociation.OWNER)) {
                    approvalFlags |= ApprovalFlags.Maintainer;
                } else if (isOwner(r.author.login)) {
                    approvalFlags |= ApprovalFlags.Owner;
                } else {
                    approvalFlags |= ApprovalFlags.Other;
                }
            }
        } else {
            // Stale review
            // Reviewers with reviews of the current commit are not stale
            if (!hasUpToDateReview.has(r.author.login)) {
                reviewersWithStaleReviews.push({ reviewedAbbrOid: r.commit.abbreviatedOid, reviewer: r.author.login });
            }
        }
    }

    return ({

        reviewersWithStaleReviews,
        approvalFlags,
        isChangesRequested
    });
}

function getDangerLevel(categorizedFiles: readonly FileLocation[]) {
    if (categorizedFiles.some(f => f.kind === "infrastructure")) {
        return "Infrastructure";
    } else {
        const packagesTouched = getPackagesTouched(categorizedFiles);
        if (packagesTouched.length === 0) {
            // ????
            return "Infrastructure";
        } else if (packagesTouched.length === 1) {
            const packageName = packagesTouched[0];
            let tested = false;
            let meta = false;
            for (const f of categorizedFiles) {
                switch (f.kind) {
                    case "infrastructure":
                        throw new Error("impossible");
                    case "definition":
                        // Expected
                        break;
                    case "test":
                        tested = true;
                        break;
                    case "package-meta":
                        meta = true;
                        break;
                    default:
                        assertNever(f);
                }
            }

            if (meta) {
                return "ScopedAndConfiguration";
            } else if (tested) {
                return "ScopedAndTested";
            } else {
                return "ScopedAndUntested";
            }
        } else {
            return "MultiplePackagesEdited";
        }
    }
}

function assertNever(n: never) {
    throw new Error("impossible");
}

function getTravisResult(headCommit: PR_repository_pullRequest_commits_nodes_commit) {
    let travisUrl: string | undefined = undefined;
    let travisResult: TravisResult = undefined!;

    const checkSuite = headCommit.checkSuites?.nodes?.[0];
    if (checkSuite) {
        switch (checkSuite.conclusion) {
            case CheckConclusionState.SUCCESS:
                travisResult = TravisResult.Pass;
                break;
            case CheckConclusionState.TIMED_OUT:
            case CheckConclusionState.CANCELLED:
            case CheckConclusionState.ACTION_REQUIRED:
            case CheckConclusionState.FAILURE:
                travisResult = TravisResult.Fail;
                travisUrl = checkSuite.url;
                break;
            case CheckConclusionState.NEUTRAL:
            default:
                travisResult = TravisResult.Pending;
                break;
        }
    } 
    
    // I'm not sure what determines why a checksuite will show, but there are cases when
    // the CI result information in the checkSuite is null, and the info is still available
    // inside the commit status results for that commit specifically.
    if (!travisResult) {
        const totalStatusChecks = headCommit.status?.contexts.find(check => check.description?.includes("Travis CI"))
        if (totalStatusChecks) {
            switch (totalStatusChecks.state) {
                case StatusState.SUCCESS:
                    travisResult = TravisResult.Pass;
                    break;
                case StatusState.PENDING:
                case StatusState.FAILURE:
                    travisResult = TravisResult.Fail;
                    travisUrl = totalStatusChecks.targetUrl;
                    break;
                
                    case StatusState.EXPECTED:
                case StatusState.PENDING:
                default:
                    travisResult = TravisResult.Pending;
                    break;
            }
        }
    }

    if (!travisResult) {
        return { travisResult: TravisResult.Missing, travisUrl: undefined };
    }

    return { travisResult, travisUrl };
}

async function getPopularityLevel(packagesTouched: string[]): Promise<PopularityLevel> {
    let popularityLevel: PopularityLevel = "Well-liked by everyone";
    for (const p of packagesTouched) {
        const downloads = await getMonthlyDownloadCount(p);
        if (downloads > CriticalPopularityThreshold) {
            // Can short-circuit
            return "Critical";
        } else if (downloads > NormalPopularityThreshold) {
            popularityLevel = "Popular";
        }
    }
    return popularityLevel;
}

function notUndefined<T>(arg: T | undefined): arg is T { return arg !== undefined; }

