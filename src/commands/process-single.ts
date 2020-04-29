import { deriveStateForPR, queryPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import * as exec from "../execute-pr-actions";
import { render } from "prettyjson";

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

    console.log(``);
    console.log(`Executing...`);
    await exec.executePrActions(actions, info.data);
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
