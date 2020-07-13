import * as compute from "../compute-pr-actions";
import { getAllOpenPRsAndCardIDs } from "../queries/all-open-prs-query";
import { queryPRInfo, deriveStateForPR } from "../pr-info";
import { executePrActions, deleteProjectCard } from "../execute-pr-actions";
import { getProjectBoardCards } from "../queries/projectboard-cards";
import { createMutation, mutate } from "../graphql-client";

const start = async function () {
  console.log(`Getting open PRs.`);

  const { prNumbers: prs, cardIDs } = await getAllOpenPRsAndCardIDs();

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

    // Show reason for ignoring PRs
    if (state.type === "remove") {
      console.log(`  Removing because of: ${state.message}`);
      continue;
    }

    // Show errors in log but keep processing to show in a comment too
    if (state.type === "error") {
      console.error(`  Error: ${state.message}`);
    }

    // Convert the info to a set of actions for the bot
    const actions = compute.process(state);

    // Act on the actions
    await executePrActions(actions, info.data);
  }

  console.log("Cleaning up cards");
  const columns = await getProjectBoardCards();

  const deleteObject = async (id: string, dry: boolean = false) => {
    if (dry) return console.log(`  Should delete "${id}"`);
    const mutation = createMutation(deleteProjectCard, { input: { cardId: id }});
    await mutate(mutation);
  }

  {
    const recentlyMerged = columns.find(c => c.name === "Recently Merged");
    if (!recentlyMerged) {
      throw new Error(`Could not find the 'Recently Merged' column in ${columns.map(n => n.name)}`);
    }
    const { cards, totalCount } = recentlyMerged;
    const afterFirst50 = cards.sort((l, r) => l.updatedAt.localeCompare(r.updatedAt))
                              .slice(50);
    if (afterFirst50.length > 0) {
      console.log(`Cutting "Recently Merged" projects to the last 50`);
      if (cards.length < totalCount) {
        console.log(`  *** Note: ${totalCount - cards.length} were not seen by this query!`);
      }
      for (const card of afterFirst50) await deleteObject(card.id);
    }
  }

  for (const column of columns) {
    if (column.name === "Recently Merged") continue;
    const ids = column.cards.map(c => c.id).filter(c => !cardIDs.includes(c));
    if (ids.length === 0) continue;
    console.log(`Cleaning up closed PRs in "${column.name}"`);
    // don't actually do the deletions, until I follow this and make sure that it's working fine
    for (const id of ids) await deleteObject(id, true);
  }

  console.log("Done");
};

start();
