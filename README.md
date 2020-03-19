This is the bot which controls the workflow of Definitely Typed PRs.



# Setup

```sh
git clone https://github.com/RyanCavanaugh/dt-mergebot.git
npm install
```

# Running Locally

To compile this repo, you need to have a GitHub API access key in either: `DT_BOT_AUTH_TOKEN`, `BOT_AUTH_TOKEN` or `AUTH_TOKEN`.
Ask Ryan for the bot's auth token (TypeScript team members: Look in the team OneNote).
Don't run the bot under your own auth token as this will generate a bunch of spam from duplicate comments.

```sh
# Windows
set BOT_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# *nix
export BOT_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx 

# Code-gen the schema
npm run graphql-schema
```

# Development

```sh
# Build
npm run build

# Run the CLI to see what would happen to an existing PR
npm run single-info -- [PR_NUM]
```

# Tests

```sh
# Run tests
npm test
```

To create fixtures of a current PR:

```sh
# To create a fixture for PR 43161
npm run create-fixture -- 43161
```

Then you can work against these fixtures offline with:

```sh
npm test -- --watch
```
