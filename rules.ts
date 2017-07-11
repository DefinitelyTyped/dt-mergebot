import * as bot from 'idembot';
import moment = require('moment');

const Labels = {
    MergeConflict: "Has Merge Conflict",
    TravisFailed: "The Travis CI build failed",
    AuthorApproved: "Author Approved",
    OtherApproved: "Other Approved",
    NeedsRevision: "Revision needed",
    Abandoned: "Abandoned",
    YSYL: "YSYL",

    Merge_Express: "Merge:Express",
    Merge_YSYL: "Merge:YSYL",
    Merge_LGTM: "Merge:LGTM"
};

const ApprovalTokens = ['👍', ':+1:', 'lgtm', 'LGTM', ':shipit:'];

namespace info {
    export namespace Travis {
        export enum Result {
            Unknown,
            NotApplicable,
            Pass,
            Fail,
            Pending
        }

        export async function getTravisStatus(issue: bot.PullRequest): Promise<Result> {
            if (!issue.isPullRequest) return Result.NotApplicable;
            if (issue.state !== "open") return Result.NotApplicable;

            const status = await issue.getStatusSummary();
            console.log(`Issue ${issue.number} has status = ${status}`);
            if (status === "failure" || status === "error") {
                return Result.Fail;
            } else if (status === "success") {
                return Result.Pass
            } else if (status === "pending") {
                return Result.Pending;
            }
            return Result.Unknown;
        }
    }

    export namespace CodeReview {
        export enum Opinion {
            // Bit flag
            None = 0,
            LGTM = 1,
            NeedsRevision = 2,
        }
        export interface Result {
            author: Opinion;
            other: Opinion;
        }
        export async function getCodeReview(issue: bot.PullRequest): Promise<Result> {
            let author = Opinion.None;
            let other = Opinion.None;

            // Parse comments
            let reviewers: string[] = [];
            const comments = await issue.getComments();
            for (const cm of comments) {
                if (cm.user.login === 'dt-bot') {
                    reviewers = parseUsernames(cm.body);

                    // Parse reactions to the dt-bot comment
                    const reactions = await cm.getReactions();
                    for (const r of reactions) {
                        if (r.content === "+1") {
                            // Approved via reaction
                            setResult(r.user.login, Opinion.LGTM);
                        } else if (r.content === "-1") {
                            // Revision requested via reaction
                            setResult(cm.user.login, Opinion.NeedsRevision);
                        }
                    }
                } else {
                    // Found a possible review comment
                    if (includesAnyOf(cm.body, ApprovalTokens)) {
                        // Approval via comment
                        setResult(cm.user.login, Opinion.LGTM);
                    }
                }
            }

            // Parse reviews
            const reviews = await issue.getReviews();
            for (const r of reviews) {
                if (r.state === "APPROVED") {
                    // Approved via code review
                    setResult(r.user.login, Opinion.LGTM);
                } else {
                    // Revision requested via code review
                    setResult(r.user.login, Opinion.NeedsRevision);
                }
            }

            return ({ author, other });

            function setResult(login: string, result: Opinion) {
                // dt-bot doesn't approve by *asking* for :+1:s
                // and users don't approve themselves by liking that post!
                if ((login === 'dt-bot') || (login === issue.user.login)) return;

                if (reviewers.indexOf(login) >= 0) {
                    author |= result;
                } else {
                    other |= result;
                }
            }
        }

        function parseUsernames(body: string): string[] {
            const result: string[] = [];
            const matchRef = /@(\w+)/g;
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
    }

    export namespace Activity {
        export async function getLastAuthorActivity(issue: bot.IssueOrPullRequest) {
            const pr = issue as bot.PullRequest;
            let lastActivity = pr.created_at;
            const comments = await issue.getComments();
            for (const c of comments) {
                if (c.user.login === pr.user.login) {
                    console.log('comment at ' + c.created_at);
                    lastActivity = moment.max(lastActivity, c.created_at);
                }
            }
            const commits = await pr.getCommitsRaw();
            for (const c of commits) {
                console.log('commit at at ' + c.commit.committer.date);
                lastActivity = moment.max(lastActivity, moment(c.commit.committer.date));
            }
            return lastActivity;
        }
    }
}

async function setLabels(issue: bot.PullRequest) {
    if (!issue.isPullRequest) return;
    if (issue.state !== "open") return;

    const mergeableState = await issue.getMergeableState();
    const hasMergeConflict = (mergeableState === false);

    const travis = await info.Travis.getTravisStatus(issue);
    const travisFailed = (travis === info.Travis.Result.Fail);

    const codeReview = await info.CodeReview.getCodeReview(issue);
    const needsToAddressCodeReview = !!((codeReview.author | codeReview.other) & info.CodeReview.Opinion.NeedsRevision);

    const unmergeable =
        hasMergeConflict ||
        travisFailed ||
        needsToAddressCodeReview;

    const mergeable = !unmergeable &&
        (travis === info.Travis.Result.Pass);

    const isAuthorApproved = codeReview.author === info.CodeReview.Opinion.LGTM;
    const isOtherApproved = codeReview.other === info.CodeReview.Opinion.LGTM;
    const needsRevision = unmergeable;

    const lgtmCutoff = moment().subtract(3, 'days');
    const ysylCutoff = moment().subtract(7, 'days');
    const abandonedCutoff = moment().subtract(7, 'days');

    const lastActivity = await info.Activity.getLastAuthorActivity(issue);
    console.log('last activity: ' + lastActivity.toString());
    console.log('ysyl cutoff: ' + ysylCutoff.toString());
    console.log('mergeable: ' + mergeable);
    const isMergeExpress = mergeable && isAuthorApproved;
    const isMergeLGTM = !isMergeExpress && (lastActivity < lgtmCutoff) && mergeable && isOtherApproved;
    const isMergeYSYL = !isMergeLGTM && (lastActivity < ysylCutoff) && mergeable;
    const isAbandoned = unmergeable && (lastActivity < abandonedCutoff);

    // Apply labels
    const labels = {
        [Labels.TravisFailed]: travisFailed,
        [Labels.MergeConflict]: hasMergeConflict,
        [Labels.AuthorApproved]: isAuthorApproved,
        [Labels.OtherApproved]: isOtherApproved,
        [Labels.NeedsRevision]: needsRevision,
        [Labels.Abandoned]: isAbandoned,
        [Labels.Merge_Express]: isMergeExpress,
        [Labels.Merge_LGTM]: isMergeLGTM,
        [Labels.Merge_YSYL]: isMergeYSYL
    };
    console.log(labels);
    issue.setHasLabels(labels);
}

const setup: bot.SetupOptions = {
    rules: {
        pullRequests: {
            setLabels
        }
    }
};

export = setup;
