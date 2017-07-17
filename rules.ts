import * as bot from 'idembot';
import moment = require('moment');
import crypto = require('crypto');

const Labels = {
    MergeConflict: "Has Merge Conflict",
    TravisFailed: "The Travis CI build failed",
    TravisMIA: "Where is Travis?",
    AuthorApproved: "Author Approved",
    OtherApproved: "Other Approved",
    NeedsRevision: "Revision needed",
    Abandoned: "Abandoned",
    YSYL: "YSYL",
    NewDefinition: "New Definition",
    Unowned: "Unowned",

    Merge_Express: "Merge:Express",
    Merge_YSYL: "Merge:YSYL",
    Merge_LGTM: "Merge:LGTM"
};

let Project: bot.Project = <any>null;
let ProjectColumns: {
    MergeExpress: bot.ProjectColumn;
    MergeLGTM: bot.ProjectColumn;
    MergeYSYL: bot.ProjectColumn;
    NewDefinitions: bot.ProjectColumn;
    Unowned: bot.ProjectColumn;
} = <any>null;

async function getProject() {
    if (Project === null) {
        Project = await bot.Project.create(762086);
        ProjectColumns = {
            MergeExpress: findColumn("Merge: Express"),
            MergeLGTM: findColumn("Merge: LGTM"),
            MergeYSYL: findColumn("Merge: YSYL"),
            NewDefinitions: findColumn("New Definitions"),
            Unowned: findColumn("Unowned")
        };
    }
}

function findColumn(name: string) {
    const col = Project.findColumnByName(name);
    if (col === undefined) throw new Error('Cannot find project column named ' + name);
    return col;
}

const ApprovalTokens = ['👍', ':+1:', 'lgtm', 'LGTM', ':shipit:'];

enum EventKind {
    AuthorActivity,
    CodeChange,
    ApprovedReview,
    RejectedReview,
    TravisFailure
}

enum TravisResult {
    Unknown,
    NotApplicable,
    Pass,
    Fail,
    Pending,
    Missing
}

function hash(s: string): string {
    return crypto.createHash('md5').update(s).digest('hex');
}

async function getTravisStatus(issue: bot.PullRequest): Promise<TravisResult> {
    if (!issue.isPullRequest) return TravisResult.NotApplicable;
    if (issue.state !== "open") return TravisResult.NotApplicable;

    const status = await issue.getStatus();
    if (status.total_count === 0) {
        return TravisResult.Missing;
    }

    const summary = status.state;
    if (summary === "failure" || summary === "error") {
        return TravisResult.Fail;
    } else if (summary === "success") {
        return TravisResult.Pass
    } else if (summary === "pending") {
        return TravisResult.Pending;
    }
    return TravisResult.Unknown;
}

enum Opinion {
    Comment,
    Approve,
    Reject
}

interface Review {
    // The login of the person who performed the review
    reviewer: string;
    // True if the reviewer is an owner of the file
    isOwner: boolean;
    // When it occurred
    date: Date;
    // The kind of CR result
    verdict: Opinion;
}

interface CodeReviews {
    reviews: Review[];
    owners: string[];
}

async function getCodeReviews(issue: bot.PullRequest): Promise<CodeReviews> {
    const result: Review[] = [];

    // Parse comments
    let owners: string[] = [];
    const comments = await issue.getComments();
    for (const cm of comments) {
        if (cm.user.login === 'dt-bot') {
            // dt-bot informs us of who the owners are
            owners = parseUsernames(cm.body);

            // Parse reactions to the dt-bot comment
            const reactions = await cm.getReactions();
            for (const r of reactions) {
                // Skip self-reactions
                if ((r.user.login === 'dt-bot') || (r.user.login === issue.user.login)) continue;

                if (r.content === "+1") {
                    // Approved via reaction
                    result.push({
                        date: new Date(r.created_at),
                        isOwner: isOwner(r.user.login),
                        reviewer: r.user.login,
                        verdict: Opinion.Approve
                    });
                } else if (r.content === "-1") {
                    // Revision requested via reaction
                    result.push({
                        date: new Date(r.created_at),
                        isOwner: isOwner(r.user.login),
                        reviewer: r.user.login,
                        verdict: Opinion.Reject
                    });
                }
            }
        } else {
            // No self-review allowed
            if (cm.user.login === issue.user.login) continue;

            // Found a possible review comment
            if (includesAnyOf(cm.body, ApprovalTokens)) {
                // Approval via comment
                result.push({
                    date: new Date(cm.created_at),
                    isOwner: isOwner(cm.user.login),
                    reviewer: cm.user.login,
                    verdict: Opinion.Approve
                });
            } else {
                // Ignore random comments
            }
        }
    }

    // Parse actual code reviews
    const reviews = await issue.getReviews();
    for (const r of reviews) {
        // No self-reviews
        if (r.user.login === issue.user.login) continue;
        // Can be "APPROVED", "CHANGES_REQUESTED", or "COMMENTED"
        const rev = {
            date: new Date(r.submitted_at),
            isOwner: isOwner(r.user.login),
            reviewer: r.user.login,
            verdict: Opinion.Comment
        };
        if (r.state === "APPROVED") {
            // Approved via code review
            rev.verdict = Opinion.Approve;
        } else if (r.state === "CHANGES_REQUESTED") {
            rev.verdict = Opinion.Reject;
        }
        result.push(rev);
    }

    // Sort by date, oldest first
    result.sort((a, b) => +a.date - +b.date);

    return ({
        reviews: result,
        owners
    });

    function isOwner(login: string) {
        return owners.indexOf(login) >= 0;
    }
}

// Returns a new array where superceded reviews are removed;
// assumes reviews are already in sorted order (oldest first)
function getLatestReviews(reviews: Review[]): Review[] {
    return reviews.filter((r, i) => {
        // Latest if no other review by the same login has a higher index.
        return !reviews.some((r2, i2) => {
            return (
                r.reviewer === r2.reviewer &&
                i2 > i
            );
        });
    });
}

function hasApprovalAndNoRejection(reviews: Review[]): boolean {
    return reviews.some(r => r.verdict === Opinion.Approve) &&
        !reviews.some(r => r.verdict === Opinion.Reject);
}

function parseUsernames(body: string): string[] {
    const result: string[] = [];
    const matchRef = /@([\w\d-_]+)/g;
    let match: RegExpExecArray | null;
    while (match = matchRef.exec(body)) {
        result.push(match[1]);
    }
    return result;
}

function includesAnyOf(haystack: string, needles: string[]) {
    for (const n of needles) {
        if (haystack.includes(n)) return true;
    }
    return false;
}


interface Commit {
    sha: string;
    date: Date;
}
async function getCommits(issue: bot.IssueOrPullRequest): Promise<Commit[]> {
    const result: Commit[] = [];
    const pr = issue as bot.PullRequest;
    const commits = await pr.getCommitsRaw();
    for (const c of commits) {
        result.push({
            sha: c.sha,
            date: new Date(c.commit.committer.date)
        });
    }
    return result;
}


async function setLabels(issue: bot.PullRequest) {
    // Skip issues and closed PRs
    if (!issue.isPullRequest) return;
    if (issue.state !== "open") return;

    await getProject();

    // See if there's a merge conflict
    const mergeableState = await issue.getMergeableState();
    const hasMergeConflict = (mergeableState === false);

    // Get Travis status
    const travis = await getTravisStatus(issue);
    const travisFailed = (travis === TravisResult.Fail);
    const travisMissing = !hasMergeConflict && (travis === TravisResult.Missing);

    const commits = await getCommits(issue);
    const lastCommit = commits[commits.length - 1];

    // All code reviews
    const { reviews, owners } = await getCodeReviews(issue);
    // Reduced to latest by author
    const latestReviews = getLatestReviews(reviews);
    // Check for approval (which may apply to a prior commit; assume PRs do not regress in this fashion)
    const ownerReviews = latestReviews.filter(r => r.isOwner);
    const otherReviews = latestReviews.filter(r => !r.isOwner);
    const isOwnerApproved = hasApprovalAndNoRejection(ownerReviews);
    const isOtherApproved = hasApprovalAndNoRejection(otherReviews);

    // Sort reviews into those before and after the latest code change
    const staleReviews = latestReviews.filter(r => r.date < lastCommit.date);
    const freshReviews = latestReviews.filter(r => r.date > lastCommit.date);

    // If a fresh review is a rejection, mark needs CR
    console.log('Fresh reviews: ' + JSON.stringify(freshReviews, undefined, 2));
    const needsToAddressCodeReview = freshReviews.some(r => r.verdict === Opinion.Reject);

    // Ping people whose non-approval needs a refresh based on new code changes
    const reviewPingList: string[] = staleReviews.filter(r => r.verdict !== Opinion.Approve).map(r => r.reviewer);

    const files = await issue.getFilesRaw();
    const isNewDefinition = files.some(file => file.status === 'added' && file.filename.endsWith('/tsconfig.json'));
    const isUnowned = !isNewDefinition && (owners.length === 0);

    const unmergeable =
        hasMergeConflict ||
        travisFailed ||
        needsToAddressCodeReview;

    const mergeable = !unmergeable &&
        (travis === TravisResult.Pass);

    const needsRevision = unmergeable;

    // The LGTM cutoff is 3 days after the last code change
    const lgtmCutoff = moment(lastCommit.date).add(3, 'days').toDate();
    // The YSYL cutoff is 5 days after the last code change
    const ysylCutoff = moment(lastCommit.date).add(5, 'days').toDate();

    // The abandoned cutoff is 7 days after a failing Travis build,
    // or 7 days after the last negative review if Travis is passing
    let abandonedCutoff = moment().add(1000, "days").toDate();;
    if (travisFailed) {
        abandonedCutoff = moment(lastCommit.date).add(7, 'days').toDate();
    } else {
        const firstBadReview = freshReviews.filter(r => r.verdict === Opinion.Reject)[0];
        if (firstBadReview) {
            abandonedCutoff = moment(firstBadReview.date).add(7, 'days').toDate();
        }
    }

    const now = new Date();

    const isMergeExpress = mergeable && isOwnerApproved;
    const isMergeLGTM = !isMergeExpress && (+now > +lgtmCutoff) && mergeable && isOtherApproved;
    const isMergeYSYL = !isMergeLGTM && (+now > +ysylCutoff) && mergeable;
    const isAbandoned = unmergeable && (+now > +abandonedCutoff);

    let coreStatus: string = 'Waiting for reviewers to give feedback.';
    let commentTag: string = 'waiting';
    let targetColumn: bot.ProjectColumn | undefined = undefined;

    if (!travisFailed && !hasMergeConflict && !needsRevision) {
        if (isNewDefinition) {
            targetColumn = ProjectColumns.NewDefinitions;
        } else if (isUnowned) {
            targetColumn = ProjectColumns.Unowned;
        }
    }

    if (travisFailed) {
        commentTag = 'complaint';
        coreStatus = `@${issue.user.login} Please fix the failures indicated in the Travis CI log.`;
    } else if (hasMergeConflict) {
        commentTag = 'complaint';
        coreStatus = `@${issue.user.login} Please address the merge conflict.`;
    } else if (needsRevision) {
        commentTag = 'complaint';
        coreStatus = `@${issue.user.login} Please address comments from the code reviewers.`;
    } else if (isMergeExpress) {
        commentTag = 'merge';
        coreStatus = `Approved by a listed owner. PR appears ready to merge pending express review by a maintainer.`;
        targetColumn = ProjectColumns.MergeExpress;
    } else if (isMergeLGTM) {
        commentTag = 'merge';
        coreStatus = `Approved by third party. PR appears ready to merge pending review by a maintainer.`;
        targetColumn = ProjectColumns.MergeLGTM;
    } else if (isMergeYSYL) {
        commentTag = 'merge';
        coreStatus = `This PR has been open and unchanged 5 days without signoff or complaint. This will be merged by a maintainer soon if there are no objections.`;
        targetColumn = ProjectColumns.MergeYSYL;
    } else if (isAbandoned) {
        commentTag = 'abandon';
        coreStatus = `@${issue.user.login} This PR appears to be abandoned and will be closed shortly if there is no other activity from you.`;
    }

    // Move to appropriate project
    await Project.setIssueColumn(issue, targetColumn);
  
    // Apply labels
    const labels = {
        [Labels.TravisFailed]: travisFailed,
        [Labels.MergeConflict]: hasMergeConflict,
        [Labels.AuthorApproved]: isOwnerApproved,
        [Labels.OtherApproved]: isOtherApproved,
        [Labels.NeedsRevision]: needsRevision,
        [Labels.Abandoned]: isAbandoned,
        [Labels.Merge_Express]: isMergeExpress,
        [Labels.Merge_LGTM]: isMergeLGTM,
        [Labels.Merge_YSYL]: isMergeYSYL,
        [Labels.TravisMIA]: travisMissing,
        [Labels.Unowned]: isUnowned,
        [Labels.NewDefinition]: isNewDefinition
    };
    
    issue.setHasLabels(labels);
    if (commentTag !== 'waiting') {
        issue.addComment(commentTag, `${coreStatus}`);
    }

    if (travisMissing) {
        issue.addComment('where-is-travis', `@${issue.user.login} - It appears Travis did not correctly run on this PR! /cc @RyanCavanaugh to investigate and advise.`);
    }

    // Ping people if they reviewed in the past but now there's a passing CI build
    if (reviewPingList.length > 0 && (travis === TravisResult.Pass)) {
        const tag = hash(reviewPingList.join(','));
        issue.addComment(`reviewPing-${tag}`,
            `${reviewPingList.map(s => '@' + s).join(' ')} - Thanks for your review of this PR! Can you please look at the new code and update your review status if appropriate?`);
    }
}

const setup: bot.SetupOptions = {
    rules: {
        pullRequests: {
            setLabels
        }
    }
};

export = setup;
