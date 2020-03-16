import { getPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import { render } from "prettyjson";

async function main() {
  const num = +process.argv[2];
  const info = await getPRInfo(num);
  console.log(``);
  console.log(`=== Raw PR Info ===`);
  console.log(render(info));

  if (info.type === "fail") {
    return;
  }

  const actions = computeActions.process(info);
  console.log(``);
  console.log(`=== Actions ===`);
  console.log(render(actions));
}

main().then(() => {
  process.exit(0);
});
