import * as computeActions from "../compute-pr-actions";
import { deriveStateForPR, queryPRInfo } from "../pr-info";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { fetchFile } from "../util/fetchFile";
import { getMonthlyDownloadCount } from "../util/npm";
import { scrubDiagnosticDetails } from "../util/util";
import { executePrActions } from "../execute-pr-actions";

export default async function main(directory: string, overwriteInfo: boolean) {
  const fixturePath = join("src", "_tests", "fixtures", directory);
  const prNumber = parseInt(directory, 10);
  if (isNaN(prNumber)) throw new Error(`Expected ${directory} to be parseable as a PR number`);

  if (!existsSync(fixturePath)) mkdirSync(fixturePath);

  const jsonFixturePath = join(fixturePath, "_response.json");
  let response;
  if (overwriteInfo || !existsSync(jsonFixturePath)) {
    response = await queryPRInfo(prNumber);
    writeFileSync(jsonFixturePath, scrubDiagnosticDetails(JSON.stringify(response, null, "  ")));
  } else {
    response = JSON.parse(readFileSync(jsonFixturePath, "utf8"));
  }

  const filesJSONPath = join(fixturePath, "_files.json");
  const filesFetched: {[expr: string]: string | undefined} = {};
  const downloadsJSONPath = join(fixturePath, "_downloads.json");
  const downloadsFetched: {[packageName: string]: number} = {};
  const derivedFixturePath = join(fixturePath, "derived.json");

  const shouldOverwrite = (file: string) => overwriteInfo || !existsSync(file);

  const derivedInfo = await deriveStateForPR(
    response,
    shouldOverwrite(filesJSONPath) ? initFetchFilesAndWriteToFile() : getFilesFromFile,
    shouldOverwrite(downloadsJSONPath) ? initGetDownloadsAndWriteToFile() : getDownloadsFromFile,
    shouldOverwrite(derivedFixturePath) ? undefined : getTimeFromFile(),
  );

  writeFileSync(derivedFixturePath, scrubDiagnosticDetails(JSON.stringify(derivedInfo, null, "  ")));

  if (derivedInfo.type === "fail") return;

  const resultFixturePath = join(fixturePath, "result.json");
  const actions = computeActions.process(derivedInfo);
  writeFileSync(resultFixturePath, scrubDiagnosticDetails(JSON.stringify(actions, null, "  ")));

  const mutationsFixturePath = join(fixturePath, "mutations.json");
  const mutations = await executePrActions(actions, response.data, /*dry*/ true);
  writeFileSync(mutationsFixturePath, scrubDiagnosticDetails(JSON.stringify(mutations.map(m => JSON.parse(m)), null, "  ")));

  console.log(`Recorded`);

  function initFetchFilesAndWriteToFile() {
    writeFileSync(filesJSONPath, "{}"); // one-time initialization of an empty storage
    return fetchFilesAndWriteToFile;
  }
  async function fetchFilesAndWriteToFile(expr: string, limit?: number) {
    filesFetched[expr] = await fetchFile(expr, limit);
    writeFileSync(filesJSONPath, JSON.stringify(filesFetched, null, "  "));
    return filesFetched[expr];
  }
  function getFilesFromFile(expr: string) {
    return JSON.parse(readFileSync(filesJSONPath, "utf8"))[expr];
  }

  function initGetDownloadsAndWriteToFile() {
    writeFileSync(downloadsJSONPath, "{}"); // one-time initialization of an empty storage
    return getDownloadsAndWriteToFile;
  }
  async function getDownloadsAndWriteToFile(packageName: string, until?: Date) {
      downloadsFetched[packageName] = await getMonthlyDownloadCount(packageName, until);
    writeFileSync(downloadsJSONPath, JSON.stringify(downloadsFetched, null, "  "));
    return downloadsFetched[packageName];
  }
  function getDownloadsFromFile(packageName: string) {
    return JSON.parse(readFileSync(downloadsJSONPath, "utf8"))[packageName];
  }

  function getTimeFromFile() {
    return JSON.parse(readFileSync(derivedFixturePath, "utf8")).now;
  }
}


if (!module.parent) {
  const num = process.argv[2]
  const overwriteInfo = process.argv.slice(2).includes("--overwrite-info")
  main(num, overwriteInfo).then(() => {
    process.exit(0)
  })
}
