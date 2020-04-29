import { queryPRInfo, deriveStateForPR } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import { render } from "prettyjson";
import { executePrActions } from "../execute-pr-actions";

async function main() {
  const num = +process.argv[2];
  const info = await queryPRInfo(num);
  const state = await deriveStateForPR(info);
  console.log(``);
  console.log(`=== Raw PR Info ===`);
  console.log(render(state));

  if (state.type !== "info") {
    return;
  }

  const actions = computeActions.process(state);
  console.log(``);
  console.log(`=== Actions ===`);
  console.log(render(actions));

  const mutations = await executePrActions(actions, info.data, /*dry*/ true);
  console.log(``);
  console.log(`=== Mutations ===`);
  console.log(render(mutations.map(m => JSON.parse(m))));
}

main().then(() => {
  console.log("Done!");
  process.exit(0);
}, err => {
  if (err?.stack) {
      console.error(err.stack);
  } else {
      console.error(err);
  }
  process.exit(1);
});
