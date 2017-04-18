import * as bot from 'idembot';

const Labels = {
    MergeConflict: "Has Merge Conflict",
    TravisFailed: "The Travis CI build failed",
    AuthorApproved: "Author Approved",
    OtherApproved: "Other Approved",
    NeedsRevision: "Revision needed"
};

async function markTravisStatus(issue: bot.PullRequest) {
    if (!issue.isPullRequest) return;
    if (issue.state !== "open") return;

    const status = await issue.getStatusSummary();
    console.log(`Issue ${issue.number} has status = ${status}`);
    issue.setHasLabels({
        [Labels.TravisFailed]: status === "failure"
    });
}

async function markApprovalState(issue: bot.PullRequest) {
    if (!issue.isPullRequest) return;
    if (issue.state !== "open") return;

    let authorApproved = false;
    let otherApproved = false;
    let needsRevision: true | null = null;

    // Parse comments
    let reviewers: string[] = [];
    const comments = await issue.getComments();
    for (const cm of comments) {
        if (cm.user.login === 'dt-bot') {
            reviewers = parseUsernames(cm.body);

            // Parse reactions
            const reactions = await cm.getReactions();
            for (const r of reactions) {
                if (r.content === "+1") {
                    console.log(`${r.user.login} approved ${issue.number} via reaction`);
                    markApproval(r.user.login);
                } else if (r.content === "-1") {
                    console.log(`${r.user.login} needs revision ${issue.number} via reaction`);
                    if (reviewers.indexOf(r.user.login) >= 0) {
                        needsRevision = true;
                    }
                }
            }
        } else {
            // Found a possible review comment
            if (includesAnyOf(cm.body, '👍', ':+1:', 'lgtm', 'LGTM', ':shipit:')) {
                console.log(`${cm.user.login} approved ${issue.number} via comment`);
                markApproval(cm.user.login);
            }
        }
    }

    // Parse reviews
    const reviews = await issue.getReviews();
    for (const r of reviews) {
        if (r.state === "APPROVED") {
            console.log(`${r.user.login} approved ${issue.number} via code review`);
            markApproval(r.user.login);
        } else {
            console.log(`${r.user.login} needs revision ${issue.number} via code review - ${r.state}`);
            if (reviewers.indexOf(r.user.login) >= 0) {
                needsRevision = true;
            }
        }
    }

    // Apply labels
    issue.setHasLabels({
        [Labels.AuthorApproved]: authorApproved && !needsRevision,
        [Labels.OtherApproved]: otherApproved && !needsRevision,
        [Labels.NeedsRevision]: needsRevision
    });

    function markApproval(login: string) {
        // dt-bot doesn't approve by *asking* for :+1:s
        // and users don't approve themselves by liking that post!
        if ((login === 'dt-bot') || (login === issue.user.login)) return;

        if (reviewers.indexOf(login) >= 0) {
            authorApproved = true;
        } else {
            otherApproved = true;
        }
    }
}

async function markMergeState(issue: bot.PullRequest) {
    if (issue.state !== "open") return;

    console.log(`Mergeable? ${await issue.getMergeableState()}`);
    issue.setHasLabels({
        [Labels.MergeConflict]: issue.mergeable === null ? null : !issue.mergeable
    });
}

const setup: bot.SetupOptions = {
    repos: [
        {
            name: "DefinitelyTyped",
            owner: "DefinitelyTyped",
            prFilter: {
                openOnly: true
            }
        }],
    rules: {
        pullRequests: {
            markTravisStatus,
            markMergeState,
            markApprovalState
        }
    }
};

function parseUsernames(body: string): string[] {
    const result: string[] = [];
    const matchRef = /@(\w+)/g;
    let match: RegExpExecArray | null;
    while (match = matchRef.exec(body)) {
        result.push(match[1]);
    }
    return result;
}

function includesAnyOf(haystack: string, ...needles: string[]) {
    for (const n of needles) {
        if (haystack.includes(n)) return true;
    }
    return false;
}

export = setup;
