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

### Idle PR Removal

When a PR:

 - Has merge conflicts, Travis CI is failing or has Reviews which reject the most recent commit
 - Has not had any commits/comments/reviews/review comments in the last 28 days
 
It will get a ping that it has two days for something to happen.

Then, assuming no new activities, a PR which:

- Has merge conflicts, Travis CI is failing or has Reviews which reject the most recent commit
- Has not had any commits/comments/reviews/review comments in the last 30 days

Will be closed.
