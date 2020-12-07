import { sha256 } from "./util/util";

export type Comment = { tag: string, status: string };

export const HadError = (user: string | undefined, error: string) => ({
    tag: "had-error",
    status: `${user ? `@${user} — ` : ""}There was an error that prevented me from properly processing this PR:

    ${error}`
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
    tag: `stale-ping-${sha256(reviewers.join("-")).substr(0, 6)}-${reviewedAbbrOid}`,
    status: `@${reviewers.join(", @")} Thank you for reviewing this PR! The author has pushed new commits since your last review. Could you take another look and submit a fresh review?`
});

export const OfferSelfMerge = (user: string, otherOwners: string[], abbrOid: string) => ({
    tag: `merge-offer`,
    // Note: pr-info.ts searches for the `(at ${abbrOid})`
    status: `@${user} Everything looks good here. Great job! I am ready to merge this PR (at ${abbrOid}) on your behalf.

If you'd like that to happen, please post a comment saying:

> Ready to merge

and I'll merge this PR almost instantly. Thanks for helping out! :heart:
${otherOwners.length === 0 ? "" : `
(${otherOwners.map(o => "@" + o).join(", ")}: you can do this too.)`}`});

export const WaitUntilMergeIsOK = (user: string, abbrOid: string, uri: string) => ({
    // at most one reminder per update
    tag: `wait-for-merge-offer-${abbrOid}`,
    status: `:passport_control: Hi @${user},

I can't [accept a merge request](${uri}) until the PR has a green CI and was appropriately reviewed. I will let you know once that happens.

Thanks, and happy typing!`
});

// Explanation for the stalness count in the welcome message
export const StalenessExplanations: { [k: string]: string } = {
    "Unmerged:nearly": "please merge or say something if there's a problem, otherwise it will move to the DT maintainer queue soon!",
    "Unmerged:done": "waiting for a DT maintainer!",
    "Abandoned:nearly": "it is considered nearly abandoned!",
    "Abandoned:done": "it is considered abandoned!",
    "Unreviewed:nearly": "please try to get reviewers!",
    "Unreviewed:done": "it is *still* unreviewed!",
};

// Comments to post for the staleness timeline (the tag is computed in `makeStaleness`)
const allOwners = (otherOwners: string[]) => {
    if (otherOwners.length > 0) return otherOwners.map(o => "@"+o).join(", ");
    // report an error, but don't fail (which would make it worse)
    console.error("  *** Possible internal error: no `otherOwners` to ping!");
    return "«anyone?»";
};
export const StalenessComment: { [k: string]: ((author: string, otherOwners: string[]) => string) | undefined } = {
    // --Unmerged--
    "Unmerged:nearly": (author: string, otherOwners: string[]) =>
        `Re-ping @${author} / ${allOwners(otherOwners)}:

This PR has been ready to merge for over a week, and I haven't seen any requests to merge it. I will close it in three weeks if this doesn't happen.

(Note that posting a comment will restart the month-timer again, so avoid doing that if you don't want me to nag you again... or you can just close it or turn it into a draft now.)`,
    "Unmerged:done": (_author: string, _otherOwners: string[]) =>
        `After a month, no one has requested merging the PR 😞. I'm going to assume that the change is not wanted after all, and will therefore close it.`,
    // --Abandoned--
    "Abandoned:nearly": (author: string, _otherOwners: string[]) =>
        `@${author} I haven't seen any activity on this PR in more than three weeks, and it still has problems that prevent it from being merged. The PR will be closed in a week if the issues aren't addressed.`,
    "Abandoned:done": (author: string, _otherOwners: string[]) =>
        `@${author} To keep things tidy, we have to close PRs that aren't mergeable and don't have activity in the last month. No worries, though — please open a new PR if you'd like to continue with this change. Thank you!`,
    // --Unreviewed--
    "Unreviewed:nearly": (_author: string, otherOwners: string[]) =>
        `Re-ping ${allOwners(otherOwners)}:

This PR has been out for over a week, yet I haven't seen any reviews.

Could someone please give it some attention? Thanks!`,
    "Unreviewed:done": (author: string, otherOwners: string[]) =>
        `It has been more than two weeks and this PR still has no reviews.

I'll bump it to the DT maintainer queue. Thank you for your patience, @${author}.

(Ping ${allOwners(otherOwners)}.)`
};
