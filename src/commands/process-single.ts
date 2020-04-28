import { getPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import * as exec from "../execute-pr-actions";
import { render } from "prettyjson";

async function main() {
    const num = +process.argv[2];
    const info = await getPRInfo(num);
    console.log(``);
    console.log(`=== Raw PR Info ===`);
    console.log(render(info));

    if (info.type !== "info") {
        return;
    }

    const actions = computeActions.process(info);
    console.log(``);
    console.log(`=== Actions ===`);
    console.log(render(actions));

    console.log(``);
    console.log(`Executing...`);
    await exec.executePrActions(actions);
}

main().then(() => {
    console.log("Done!");
    process.exit(0);
});
