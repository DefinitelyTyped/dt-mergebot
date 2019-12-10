import { getPRInfo } from "./pr-info";
import { createProcessor, DefaultContext } from "./pr-treeage";
import * as chalk from "chalk"

async function main() {
    const number = +process.argv[2];
    const info = await getPRInfo({ number });
    console.log(chalk.bold("Reponse to the PR GraphQL query:"))
    console.log(chalk.gray(JSON.stringify(info, undefined, 2)));

    const context = { ...DefaultContext };
    if (info.type === "info") {
        createProcessor(context)(info);
        console.log(chalk.bold("\n\nAction context:\n"))
        console.log(context)
    }
}

main().then(() => {
    process.exit(0);
});

