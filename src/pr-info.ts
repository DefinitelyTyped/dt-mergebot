import { GetPRInfo } from "./queries/pr-query";

import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest, PR_repository_pullRequest_commits_nodes_commit, PR_repository_pullRequest, PR_repository_pullRequest_timelineItems, PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent, PR_repository_pullRequest_reviews, PR_repository_pullRequest_timelineItems_nodes_IssueComment } from "./queries/schema/PR";

import { TravisResult } from "./util/travis";
import { StatusState, PullRequestReviewState, CommentAuthorAssociation, CheckConclusionState, PullRequestState } from "./queries/graphql-global-types";
import { getMonthlyDownloadCount } from "./util/npm";
import { client } from "./graphql-client";
import { ApolloQueryResult } from "apollo-boost";
import { getOwnersOfPackages, OwnerInfo } from "./util/getOwnersOfPackages";
import { findLast, forEachReverse, daysSince } from "./util/util";


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

export interface BotEnsureRemovedFromProject {
    readonly type: "remove";
    readonly pr_number: number;
    readonly message: string;
}

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
     * The date the PR author last had a meaningful interaction with the PR
     */
    readonly lastAuthorCommentDate: Date;

    /**
     * The date the PR was last reopened by a maintainer
     */
    readonly reopenedDate?: Date;

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
export async function deriveStateForPR(
    info: ApolloQueryResult<PRQueryResult>,
    getOwners?: (packages: readonly string[]) => OwnerInfo | Promise<OwnerInfo>,
    getDownloads?: (packages: readonly string[]) => Record<string, number> | Promise<Record<string, number>>,
    getNow = () => new Date(),
): Promise<PrInfo | BotFail | BotEnsureRemovedFromProject>  {
    const prInfo = info.data.repository?.pullRequest;
    // console.log(JSON.stringify(prInfo, undefined, 2));
    
    if (!prInfo) return botFail("No PR with this number exists");
    if (prInfo.author == null) return botFail("PR author does not exist");
    
    const headCommit = getHeadCommit(prInfo);
    if (headCommit == null) return botFail("No head commit");

    if (prInfo.state !== "OPEN") return botEnsureRemovedFromProject(prInfo.number, "PR is not active");
    if (prInfo.isDraft) return botEnsureRemovedFromProject(prInfo.number, "PR is a draft");
    
    const categorizedFiles = noNulls(prInfo.files?.nodes).map(f => categorizeFile(f.path));
    const packages = getPackagesTouched(categorizedFiles);

    const { anyPackageIsNew, allOwners } = getOwners ? await getOwners(packages) : await getOwnersOfPackages(packages);
    const authorIsOwner = isOwner(prInfo.author.login);
    
    const isFirstContribution = prInfo.authorAssociation === CommentAuthorAssociation.FIRST_TIME_CONTRIBUTOR;
    
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
        if (allOwners.indexOf(review?.author?.login || "") >= 0) {
            // Known package owner
            return "owner";
        }
        return "other";
    });
    
    
    const lastPushDate = new Date(headCommit.pushedDate);
    const now = getNow().toISOString();

    return {
        type: "info",
        now,
        pr_number: prInfo.number,
        author: prInfo.author.login,
        owners: allOwners,
        dangerLevel: getDangerLevel(categorizedFiles),
        headCommitAbbrOid: headCommit.abbreviatedOid,
        headCommitOid: headCommit.oid,
        mergeIsRequested: authorSaysReadyToMerge(prInfo),
        stalenessInDays: daysSince(headCommit.pushedDate, now),
        lastCommitDate: lastPushDate,
        reopenedDate: getReopenedDate(prInfo.timelineItems),
        lastAuthorCommentDate: getLastAuthorActivityDate(prInfo.author.login, prInfo.timelineItems, prInfo.reviews) || lastPushDate,
        reviewLink: `https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${prInfo.number}/files`,
        hasMergeConflict: prInfo.mergeable === "CONFLICTING",
        authorIsOwner, isFirstContribution,
        popularityLevel: getDownloads
            ? getPopularityLevelFromDownloads(await getDownloads(packages))
            : await getPopularityLevel(packages),
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
        return { type: "fail", message };
    }
    

    function botEnsureRemovedFromProject(prNumber: number, message: string): BotEnsureRemovedFromProject {
        return { type: "remove", pr_number: prNumber, message };
    }

    function isOwner(login: string) {
        return allOwners.some(k => k.toLowerCase() === login.toLowerCase());
    }
}

type ReopenedEvent = PR_repository_pullRequest_timelineItems_nodes_ReopenedEvent;

function getReopenedDate(timelineItems: PR_repository_pullRequest_timelineItems) {
    const createdAt = findLast(timelineItems.nodes, (item): item is ReopenedEvent => item?.__typename === "ReopenedEvent")?.createdAt;
    if (createdAt) {
        return new Date(createdAt);
    }
    return undefined;
}

type IssueComment = PR_repository_pullRequest_timelineItems_nodes_IssueComment;
function getLastAuthorActivityDate(authorLogin: string, timelineItems: PR_repository_pullRequest_timelineItems, reviews: PR_repository_pullRequest_reviews | null) {
    const lastIssueComment = findLast(timelineItems.nodes, (item): item is IssueComment => {
        return item?.__typename === "IssueComment" && item.author?.login === authorLogin;
    });
    const lastReviewComment = forEachReverse(reviews?.nodes, review => {
        return findLast(review?.comments?.nodes, comment => {
            return comment?.author?.login === authorLogin;
        });
    });
    if (lastIssueComment && lastReviewComment) {
        return new Date([
            lastIssueComment.createdAt,
            lastReviewComment.createdAt
        ].sort()[1]);
    }
    if (lastIssueComment || lastReviewComment) {
        return new Date((lastIssueComment || lastReviewComment)?.createdAt);
    }
    return undefined;
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

function categorizeFile(filePath: string): FileLocation {
    const typeDefinitionFile = /^types\/([^\/]+)\/(.*)\.d\.ts$/i;
    // https://regex101.com/r/QfAfRn/1
    const typeTestFile = /^types\/([^\/]+)\/(.*)\.tsx?$/i;
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
    throw new Error(`Impossible: ${n}`);
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

function getPopularityLevelFromDownloads(downloadsPerPackage: Record<string, number>) {
    let popularityLevel: PopularityLevel = "Well-liked by everyone";
    for (const packageName in downloadsPerPackage) {
        const downloads = downloadsPerPackage[packageName];
        if (downloads > CriticalPopularityThreshold) {
            // Can short-circuit
            return "Critical";
        } else if (downloads > NormalPopularityThreshold) {
            popularityLevel = "Popular";
        }
    }
    return popularityLevel;
}


