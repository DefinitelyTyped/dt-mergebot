import { getPRInfo } from "./pr-info";
import { process as processPR, DefaultContext } from "./pr-treeage";

async function main() {
    const num = +process.argv[2];
    const info = await getPRInfo(num);
    console.log(JSON.stringify(info, undefined, 2));

    if (info.type === "fail") {
        return;
    }

    const context = processPR(info);
    console.log(JSON.stringify(context, undefined, 2));
}

main().then(() => {
    process.exit(0);
});
