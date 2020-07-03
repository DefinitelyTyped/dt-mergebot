import * as compute from "../compute-pr-actions";
import { getAllOpenPRs } from "../queries/all-open-prs-query";
import { queryPRInfo, deriveStateForPR } from "../pr-info";
import { executePrActions, deleteProjectCard } from "../execute-pr-actions";
import { getRecentlyUpdatedPRProjectBoardCards } from "../queries/recently-merged-prs-project";
import { createMutation, mutate } from "../graphql-client";

const start = async function () {
  console.log(`Getting open PRs.`);

  const prs = await getAllOpenPRs();

  for (const pr of prs) {
    console.log(`Processing #${pr} (${prs.indexOf(pr) + 1} of ${prs.length})...`);

    // Generate the info for the PR from scratch
    const info = await queryPRInfo(pr);
    const state = await deriveStateForPR(info);

    // If it didn't work, bail early
    if (state.type === "fail") {
      console.error(`  Failed because of: ${state.message}`);
      continue;
    }

    // Allow the state to declare that nothing should happen
    if (state.type === "no_packages") {
      console.error(`  NOOPing because no packages`);
      continue;
    }

    // Show reason for ignoring PRs
    if (state.type === "remove") {
      console.log(`  Removing because of: ${state.message}`);
      continue;
    }

    // Convert the info to a set of actions for the bot
    const actions = compute.process(state);

    // Act on the actions
    await executePrActions(actions, info.data);
  }

  console.log(`Cutting 'recently merged' projects to the last 50`);

  const allRecentlyUpdatedPRs = await getRecentlyUpdatedPRProjectBoardCards();
  const afterFirst50 = allRecentlyUpdatedPRs.sort((l, r) => l.updatedAt.localeCompare(r.updatedAt))
                                            .filter((_, i) => i > 50);
  for (const node of afterFirst50) {
    const mutation =  createMutation(deleteProjectCard, { id: node.id });
    await mutate(mutation);
  }

  console.log("Done");
};

start();
