export type Comment = { tag: string, status: string };

export const SorryAbandoned = (user: string) => ({
    tag: "abandon-sorry",
    status: `@${user} To keep things tidy, we have to close PRs that aren't mergeable but don't have activity from their author. No worries, though - please open a new PR if you'd like to continue with this change. Thank you!`
});

export const NearlyAbandoned = (user: string) => ({
    tag: "abandon-warn",
    status: `@${user} I haven't seen anything from you in a while and this PR currently has problems that prevent it from being merged. The PR will be closed tomorrow if there aren't new commits to fix the issues.`
});

export const TravisFailed = (slug: string, user: string, travisUrl: string) => ({
    tag: `complaint-${slug}`,
    status: `@${user} The Travis CI build failed! Please [review the logs for more information](${travisUrl}).\r\n\r\nOnce you've pushed the fixes, the build will automatically re-run. Thanks!`
});

export const MergeConflicted = (slug: string, user: string) => ({
    tag: `merge-complaint-${slug}`,
    status: `@${user} Unfortunately, this pull request currently has a merge conflict 😥. Please update your PR branch to be up-to-date with respect to master. Have a nice day!`
});

export const ChangesRequest = (user: string) => ({
    tag: "complaint",
    status: `@${user} One or more reviewers has requested changes. Please address their comments. I'll be back once they sign off or you've pushed new commits or comments. Thank you!`
});

export const ApprovedByOwner = () => ({
    tag: "merge",
    status: "A definition owner has approved this PR ⭐️. A maintainer will merge this PR shortly. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for your contribution to DefinitelyTyped!"
});

export const AuthorIsOwnerAndGreen = () => ({
    tag: "merge",
    status: "Since you're a listed owner and the build passed, this PR is fast-tracked. A maintainer will merge shortly. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for your contribution to DefinitelyTyped!"
});

export const LGTM = () => ({
    tag: "merge",
    status: "We've gotten sign-off from a reviewer 👏. A maintainer will soon review this PR and merge it if there are no issues. If it shouldn't be merged yet, please leave a comment saying so and we'll wait. Thank you for contributing to DefinitelyTyped!"
});

export const YSYL = () => ({
    tag: "merge",
    status: "After 5 days, no one has reviewed the PR 😞. A maintainer will be reviewing the PR in the next few days and will either merge it or request revisions. Thank you for your patience!"
});

export const Welcome = (login: string, isFirstPR: boolean) => `@${login} Thank you for submitting this PR!${isFirstPR ? " I see this is your first PR to DefinitelyTyped - don't worry, I'll be helping you throughout the process. Stay tuned for updates." : ""}`;
export const PingReviewers = (names: readonly string[], reviewLink: string) => `🔔 ${names.map(n => `@${n}`).join(" ")} - please [review this PR](${reviewLink}) in the next few days. Be sure to explicitly select **\`Approve\`** or **\`Request Changes\`** in the GitHub UI so I know what's going on.`;
export const NewDefinition = `Because this is a new definition, a DefinitelyTyped maintainer will be reviewing this PR in the next few days once the Travis CI build passes.`;
export const NoOtherReviewers = `Because this PR doesn't have any code reviewers, a DefinitelyTyped maintainer will be reviewing it in the next few days once the Travis CI build passes.`;

export const AutoMergeChecklist = (travisGreen: boolean, noMergeConflict: boolean, approved: boolean) => {
    
};

