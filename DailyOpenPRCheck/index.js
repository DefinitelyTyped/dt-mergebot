// @ts-check

const { getAllOpenPRs } = require("../bin/queries/all-open-prs-query");
const { queryPRInfo, deriveStateForPR } = require("../bin/pr-info");
const compute = require("../bin/compute-pr-actions");
const { executePrActions } = require("../bin/execute-pr-actions");

/** @type {import("@azure/functions").AzureFunction} */
const run = async function (context) {
  context.log.info(`Getting open PRs.`);

  const prs = await getAllOpenPRs();

  for (const pr of prs) {
    context.log.info(`Processing #${pr} (${prs.indexOf(pr) + 1} of ${prs.length})...`);

    // Generate the info for the PR from scratch
    const info = await queryPRInfo(pr);
    const state = await deriveStateForPR(info);

    // If it didn't work, bail early
    if (state.type === "fail") {
      return context.log.error(`Failed because of: ${state.message}`);
    }

    // Allow the state to declare that nothing should happen
    if (state.type === "noop") {
      return context.log.info(`NOOPing because of: ${state.message}`);
    }

    // Convert the info to a set of actions for the bot
    const actions = compute.process(state);

    // Act on the actions
    await executePrActions(actions, info.data);
  }
};

export default run;
