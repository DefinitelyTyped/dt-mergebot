import { getPRInfo } from "./pr-info";

async function main() {
    const num = +process.argv[2];
    const info = await getPRInfo(num);
    console.log(JSON.stringify(info, undefined, 2));
}

main().then(() => {
    process.exit(0);
});

