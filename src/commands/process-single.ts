import { deriveStateForPR, queryPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import * as exec from "../execute-pr-actions";
import { render } from "prettyjson";
import { formatMutationRequest } from "../util/formatMutationRequest";

export default async function main(prNumber: number, log: (...args: any[]) => void, dry?: boolean) {
    const info = await queryPRInfo(prNumber);
    const state = await deriveStateForPR(info);
    log(``);
    log(`=== Raw PR Info ===`);
    log(render(state));

    if (state.type === "fail") {
        return [];
    }

    const actions = computeActions.process(state);
    log(``);
    log(`=== Actions ===`);
    log(render(actions));

    log(``);
    log(dry ? `Simulating execution...` : `Executing...`);

    const mutations = await exec.executePrActions(actions, info.data, dry);
    log(``);
    log(`=== Mutations ===`);
    log(render(mutations.map(formatMutationRequest)));
    return mutations;
}

if (!module.parent) {
    const num = +process.argv[2];
    const dry = process.argv.slice(2).includes('--dry');
    main(num, console.log.bind(console), dry).then(() => {
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
}
