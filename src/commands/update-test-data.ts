import * as fs from "fs";
import * as path from "path";
import * as cachedQueries from "../util/cachedQueries";

async function main() {
  const dataPath = path.resolve(__dirname, "../_tests/cachedQueries.json");
  const data: any = {};

  for (const query in cachedQueries) {
    data[query] = await cachedQueries[query as keyof typeof cachedQueries]();
  }

  await fs.promises.writeFile(dataPath, JSON.stringify(data, undefined, 2), 'utf8');
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
