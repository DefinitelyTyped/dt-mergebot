This is the bot which controls the workflow of Definitely Typed PRs.

# Setup

```sh
git clone https://github.com/RyanCavanaugh/dt-mergebot.git
npm install
```

# Running

To compile this repo, you need to have a GitHub API access key in either: `DT_BOT_AUTH_TOKEN`, `BOT_AUTH_TOKEN` or `AUTH_TOKEN`.
Ask Ryan for the bot's auth token (TypeScript team members: Look in the team OneNote).
Don't run the bot under your own auth token as this will generate a bunch of spam from duplicate comments.

```sh
# Windows
set AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# *nix
export DT_BOT_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx 

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

### Getting Webhooks locally from GitHub

1. Install [ngrok](https://ngrok.com/) and start it with `ngrok http 5000`. It will give you an address like
   `https://9cbc94d15.ngrok.io/`.

2. Create a [new webhook on the DT repo](https://github.com/DefinitelyTyped/DefinitelyTyped/settings/hooks/new)

- Set your **webhook url** to be: https://9cbc94d15.ngrok.io/

- You will need your a copy of your private key, it will be used inside your `.env` later.

3. Start your server, this will go on port 5000 - and be active over the web on your ngrok address.

4. Set up your own `.env` based on the example one with your org's settings.

5. OK, you're good to go.

6. Go the the integration page, and hit the "Install" button in the top left, then add it to a repo. This should start
   sending data to your server. You should see a `POST /webhook 200 OK` to indicate that it's set up in ngrok. You
   should see

Your tools for working with this data are those webhook notifications on the GitHub App's "advanced" page, re-send
events to iterate on your code. You can also re-send them [from ngrok local](http://localhost:4040/inspect/http).

