import crypto = require("crypto");

export type Comment = { tag: string, status: string };

export const HadError = (user: string | undefined, error: string) => ({
    tag: "had-error",
    status: `${user ? `@${user} — ` : ""}There was an error that prevented me from properly processing this PR:

    ${error}`
});

export const SorryAbandoned = (user: string) => ({
    tag: "abandon-sorry",
    status: `@${user} To keep things tidy, we have to close PRs that aren't mergeable and don't have activity in the last month. No worries, though — please open a new PR if you'd like to continue with this change. Thank you!`
});

export const NearlyAbandoned = (user: string) => ({
    tag: "abandon-warn",
    status: `@${user} I haven't seen any activity on this PR in more than 3 weeks, and this PR currently has problems that prevent it from being merged. The PR will be closed in a week if the issues aren't addressed.`
});

export const YSYL = () => ({
    tag: "merge",
    status: "After a week, no one has reviewed the PR 😞. A maintainer will be reviewing the PR in the next few days and will either merge it or request revisions. Thank you for your patience!"
});

export const NearlyYSYL = (user: string) => ({
    tag: "ysyl-warn",
    status: `@${user} I haven't seen any activity on this PR in almost a week. The PR will move to the DT maintainer queue soon if there is no further activity.  Please merge it or say why it shouldn't be soon.`
});

export const CIFailed = (slug: string, user: string, ciUrl: string) => ({
    tag: `gh-actions-complaint-${slug}`,
    status: `@${user} The CI build failed! Please [review the logs for more information](${ciUrl}).\r\n\r\nOnce you've pushed the fixes, the build will automatically re-run. Thanks!`
});

export const MergeConflicted = (slug: string, user: string) => ({
    tag: `merge-complaint-${slug}`,
    status: `@${user} Unfortunately, this pull request currently has a merge conflict 😥. Please update your PR branch to be up-to-date with respect to master. Have a nice day!`
});

export const ChangesRequest = (headOid: string, user: string) => ({
    tag: `reviewer-complaint-${headOid}`,
    status: `@${user} One or more reviewers has requested changes. Please address their comments. I'll be back once they sign off or you've pushed new commits or comments. If you disagree with the reviewer's comments, you can "dismiss" the review using GitHub's review UI. Thank you!`
});

export const PingReviewers = (names: readonly string[], reviewLink: string) => ({
    tag: "pinging-reviewers",
    status: `🔔 ${names.map(n => `@${n}`).join(" ")} — please [review this PR](${reviewLink}) in the next few days. Be sure to explicitly select **\`Approve\`** or **\`Request Changes\`** in the GitHub UI so I know what's going on.`
});

export const PingReviewersOther = (user: string, reviewLink: string) => ({
    tag: "pinging-reviewers-others",
    status: `🔔 @${user} — you're the only owner, but it would still be good if you find someone to [review this PR](${reviewLink}) in the next few days, otherwise a maintainer will look at it. (And if you do find someone, maybe even recruit them to be a second owner to make future changes easier...)`
});

export const PingReviewersTooMany = (names: readonly string[]) => ({
    tag: "pinging-reviewers-too-many",
    status: `⚠️ There are too many reviewers for this PR change (${names.length}). Merging can only be handled by a DT maintainer.

<details>
<summary>People who would have been pinged</summary>
${names.map(n => `${n}`).join(" ")}
</details>`
});

export const PingStaleReviewer = (reviewedAbbrOid: string, reviewers: string[]) => ({
    tag: `stale-ping-${tinyHash(reviewers.join("-"))}-${reviewedAbbrOid}`,
    status: `@${reviewers.join(", @")} Thank you for reviewing this PR! The author has pushed new commits since your last review. Could you take another look and submit a fresh review?`
});

export const AskForAutoMergePermission = (user: string, otherOwners: string[]) => ({
    tag: `merge-offer`,
    status: `@${user} Everything looks good here. Great job! I am ready to merge this PR on your behalf.

If you'd like that to happen, please post a comment saying:

> Ready to merge

and I'll merge this PR almost instantly. Thanks for helping out! :heart:
${otherOwners.length === 0 ? "" : `
(${otherOwners.map(o => "@" + o).join(", ")}: you can do this too.)`}`});

function tinyHash(s: string): string {
    return crypto.createHash("sha256").update(s).digest("hex").substr(0, 6);
}
