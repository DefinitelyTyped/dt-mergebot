_Disclaimer: This could be out of date, the source of truth is always [compute-pr-actions.ts](https://github.com/DefinitelyTyped/dt-mergebot/blob/master/src/compute-pr-actions.ts)_

### What PRs does the bot ignore

- Draft PRs
- Closed PRs

### What type of PRs need to be reviewed by a DT maintainer

- PRs which affect DT infrastructure
- PRs which affect more than 50 Definition Owners
- PRs which affect extremely popular packages (5m downloads per month)
- PRs which add new packages
- PRs which change DT types with no tests
- PRs which change DT types and there are no other Definition Owners
- PRs which change a DT module's infra (`tsconfig.json` etc)

### Blessing PRs

If a PR looks kind of ok, but you don't want to submit an approving review for whatever reason (needs specific knowledge, or you don't want to fight over adding tests but you don't want to make it seem ok, etc), then move the PR *away* from the `Needs Maintainer Review` and the bot will interpret that as an implicit blessing.
(Do this using the dropdown column in the "Projects" box on the right.)
Like reviews, updates to the PR will void such a blessing.

The column you move it to doesn't make any difference to the bot, it will move it to the right one if needed, but it works best to move it to `Waiting for Code Reviews`, and at most get more reviews.
**Disclaimer:** It is currently impossible to get from/to information about column moves, so the bot ignores the column it was moved from.  This means that it is impossible to cancel a blessing, but you can still submit a review if changes are needed.

### Idle PR Removal

When a PR:

- Has merge conflicts, CI is failing or has Reviews which reject the most recent commit
- Has not had any commits/comments/reviews/review comments in the last three weeks

it will get a ping that it has about a week for something to happen.

Then, assuming no new activities, a PR which:

- Has merge conflicts, CI is failing or has Reviews which reject the most recent commit
- Has not had any commits/comments/reviews/review comments in the last 30 days

will be closed.

For PRs that are ready to merge but were not, there is a similar (but
much shorter) progression: pinged after 4 days, and moved to YSYL state
after 8.
