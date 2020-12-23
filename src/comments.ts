import { sha256 } from "./util/util";

// use `deletedWhenNotPresent` for comments that should be removed if not in the actions
export const tagsToDeleteIfNotPosted: string[] = [];
const deletedWhenNotPresent = <T>(tag: string, f: (tag: string) => T) => {
    tagsToDeleteIfNotPosted.push(tag);
    return f(tag);
};

export type Comment = { tag: string, status: string };

export const HadError = (user: string | undefined, error: string) => ({
    tag: "had-error",
    status: `${user ? `@${user} — ` : ""}There was an error that prevented me from properly processing this PR:

    ${error}`
});

export const CIFailed = (abbrOid: string, user: string, ciUrl: string) => ({
    tag: `gh-actions-complaint-${abbrOid}`,
    status: `@${user} The CI build failed! Please [review the logs for more information](${ciUrl}).\r\n\r\nOnce you've pushed the fixes, the build will automatically re-run. Thanks!`
});

export const MergeConflicted = (abbrOid: string, user: string) => ({
    tag: `merge-complaint-${abbrOid}`,
    status: `@${user} Unfortunately, this pull request currently has a merge conflict 😥. Please update your PR branch to be up-to-date with respect to master. Have a nice day!`
});

export const ChangesRequest = (abbrOid: string, user: string) => ({
    tag: `reviewer-complaint-${abbrOid}`,
    status: `@${user} One or more reviewers has requested changes. Please address their comments. I'll be back once they sign off or you've pushed new commits. Thank you!`
});

export const SuggestTesting = deletedWhenNotPresent("suggest-testing", tag =>
    (user: string, testsLink: string) => ({
        tag, status: `Hey @${user},

:unamused: Your PR doesn't modify any tests, so it's hard to know what's being fixed, and your changes might regress in the future. Please consider [adding tests](${testsLink}) to cover the change you're making. Including tests allows this PR to be merged by yourself and the owners of this module. This can potentially save days of time for you.`
    }));

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
    tag: `stale-ping-${sha256(reviewers.join("-")).substr(0, 6)}-${reviewedAbbrOid}`,
    status: `@${reviewers.join(", @")} Thank you for reviewing this PR! The author has pushed new commits since your last review. Could you take another look and submit a fresh review?`
});

export const OfferSelfMerge = deletedWhenNotPresent("merge-offer", tag =>
    (user: string, otherOwners: string[], abbrOid: string) => ({
        // Note: pr-info.ts searches for the `(at ${abbrOid})`
        tag, status: `@${user} Everything looks good here. Great job! I am ready to merge this PR (at ${abbrOid}) on your behalf.

If you'd like that to happen, please post a comment saying:

> Ready to merge

and I'll merge this PR almost instantly. Thanks for helping out! :heart:
${otherOwners.length === 0 ? "" : `
(${otherOwners.map(o => "@" + o).join(", ")}: you can do this too.)`}`}));

export const WaitUntilMergeIsOK = (user: string, abbrOid: string, uri: string) => ({
    // at most one reminder per update
    tag: `wait-for-merge-offer-${abbrOid}`,
    status: `:passport_control: Hi @${user},

I can't [accept a merge request](${uri}) until the PR has a green CI and was appropriately reviewed. I will let you know once that happens.

Thanks, and happy typing!`
});

// Explanation for the stalness count in the welcome message
export const StalenessExplanations: { [k: string]: string } = {
    "Unmerged:nearly": "please merge or say something if there's a problem, otherwise it will be closed!",
    "Unmerged:done": "closed because it wasn't merged for a long time!",
    "Abandoned:nearly": "it is considered nearly abandoned!",
    "Abandoned:done": "it is considered abandoned, and therefore closed!",
    "Unreviewed:nearly": "please try to get reviewers!",
    "Unreviewed:done": "it is *still* unreviewed!",
};

// Comments to post for the staleness timeline (the tag is computed in `makeStaleness`)
export const StalenessComment = (author: string, otherOwners: string[], expires: Date) => {
    const owners = otherOwners.length === 0 ? "«anyone?»" : otherOwners.map(o => "@"+o).join(", ");
    const { format } = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
    return {
        // --Unmerged--
        "Unmerged:nearly": `Re-ping @${author} / ${owners}:

This PR has been ready to merge for over a week, and I haven't seen any requests to merge it. I will close it on ${format(expires)} (in three weeks) if this doesn't happen.

(If there's no reason to avoid merging it, please do so.  Otherwise, if it shouldn't be merged or if it needs more time, please close it or turn it into a draft.)`,
        "Unmerged:done": `After a month, no one has requested merging the PR 😞. I'm going to assume that the change is not wanted after all, and will therefore close it.`,
        // --Abandoned--
        "Abandoned:nearly": `@${author} I haven't seen any activity on this PR in more than three weeks, and it still has problems that prevent it from being merged. The PR will be closed on ${format(expires)} (in a week) if the issues aren't addressed.`,
        "Abandoned:done": `@${author} To keep things tidy, we have to close PRs that aren't mergeable and don't have activity in the last month. No worries, though — please open a new PR if you'd like to continue with this change. Thank you!`,
        // --Unreviewed--
        "Unreviewed:nearly": `Re-ping ${owners}:

This PR has been out for over a week, yet I haven't seen any reviews.

Could someone please give it some attention? Thanks!`,
        "Unreviewed:done": `It has been more than two weeks and this PR still has no reviews.

I'll bump it to the DT maintainer queue. Thank you for your patience, @${author}.

(Ping ${owners}.)`} as { [k: string]: string };
};
