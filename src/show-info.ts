import { getPRInfo } from "./pr-info";
import { createProcessor, DefaultContext } from "./pr-treeage";

async function main() {
    const num = +process.argv[2];
    const info = await getPRInfo(num);
    console.log(JSON.stringify(info, undefined, 2));

    const context = { ...DefaultContext };
    if (info.type === "info") {
        createProcessor(context)(info);
        console.log(JSON.stringify(context, undefined, 2));
    }
}

main().then(() => {
    process.exit(0);
});

