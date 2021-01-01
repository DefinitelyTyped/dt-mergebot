import { print } from "graphql";
import * as computeActions from "../compute-pr-actions";
import { deriveStateForPR, BotResult, queryPRInfo } from "../pr-info";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { fetchFile } from "../util/fetchFile";
import { getMonthlyDownloadCount } from "../util/npm";
import { scrubDiagnosticDetails } from "../util/util";
import { executePrActions } from "../execute-pr-actions";

export default async function main(directory: string, overwriteInfo: boolean) {
  const writeJsonSync = (file: string, json: unknown) =>
      writeFileSync(file, scrubDiagnosticDetails(JSON.stringify(json, undefined, 2) + "\n"));

  const fixturePath = join("src", "_tests", "fixtures", directory);
  const prNumber = parseInt(directory, 10);
  if (isNaN(prNumber)) throw new Error(`Expected ${directory} to be parseable as a PR number`);

  if (!existsSync(fixturePath)) mkdirSync(fixturePath);

  const jsonFixturePath = join(fixturePath, "_response.json");
  let response;
  if (overwriteInfo || !existsSync(jsonFixturePath)) {
    response = await queryPRInfo(prNumber);
    writeJsonSync(jsonFixturePath, response);
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

  writeJsonSync(derivedFixturePath, derivedInfo);

  if (derivedInfo.type === "fail") return;

  const resultFixturePath = join(fixturePath, "result.json");
  const actions = computeActions.process(derivedInfo);
  writeJsonSync(resultFixturePath, actions);

  const mutationsFixturePath = join(fixturePath, "mutations.json");
  const mutations = await executePrActions(actions, response.data, /*dry*/ true);
  writeJsonSync(mutationsFixturePath, mutations.map(({ mutation, ...options }) => ({ mutation: print(mutation), ...options })));

  console.log(`Recorded`);

  function initFetchFilesAndWriteToFile() {
    writeJsonSync(filesJSONPath, {}); // one-time initialization of an empty storage
    return fetchFilesAndWriteToFile;
  }
  async function fetchFilesAndWriteToFile(expr: string, limit?: number) {
    filesFetched[expr] = await fetchFile(expr, limit);
    writeJsonSync(filesJSONPath, filesFetched);
    return filesFetched[expr];
  }
  function getFilesFromFile(expr: string) {
    return JSON.parse(readFileSync(filesJSONPath, "utf8"))[expr];
  }

  function initGetDownloadsAndWriteToFile() {
    writeJsonSync(downloadsJSONPath, {}); // one-time initialization of an empty storage
    return getDownloadsAndWriteToFile;
  }
  async function getDownloadsAndWriteToFile(packageName: string, until?: Date) {
      downloadsFetched[packageName] = await getMonthlyDownloadCount(packageName, until);
    writeJsonSync(downloadsJSONPath, downloadsFetched);
    return downloadsFetched[packageName];
  }
  function getDownloadsFromFile(packageName: string) {
    return JSON.parse(readFileSync(downloadsJSONPath, "utf8"))[packageName];
  }

  function getTimeFromFile() {
    return (JSON.parse(readFileSync(derivedFixturePath, "utf8")) as BotResult).now;
  }
}


if (!module.parent) {
  const num = process.argv[2]
  const overwriteInfo = process.argv.slice(2).includes("--overwrite-info")
  main(num, overwriteInfo).then(() => {
    process.exit(0)
  })
}
