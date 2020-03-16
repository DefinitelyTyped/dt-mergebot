import { getPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import * as exec from "../execute-pr-actions";

async function main() {
    const num = +process.argv[2];
    const info = await getPRInfo(num);
    console.log(``);
    console.log(`=== Raw PR Info ===`);
    console.log(JSON.stringify(info, undefined, 2));

    if (info.type === "fail") {
        return;
    }

    const actions = computeActions.process(info);
    console.log(``);
    console.log(`=== Actions ===`);
    console.log(JSON.stringify(actions, undefined, 2));

    console.log(``);
    console.log(`Executing...`);
    await exec.executePrActions(actions);
}

main().then(() => {
    console.log("Done!");
    process.exit(0);
});
