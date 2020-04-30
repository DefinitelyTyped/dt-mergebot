import * as assert from "assert";
import * as computeActions from "../compute-pr-actions";
import { deriveStateForPR, queryPRInfo, PrInfo } from "../pr-info";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { getOwnersOfPackages } from "../util/getOwnersOfPackages";
import { executePrActions } from "../execute-pr-actions";
import { getMonthlyDownloadCount } from "../util/npm";

export default async function main(directory: string, overwriteInfo: boolean) {
  const fixturePath = join("src", "_tests", "fixtures", directory)
  const prNumber = parseInt(directory, 10);
  if (isNaN(prNumber)) throw new Error(`Expected ${directory} to be parseable as a PR number`);

  if (!existsSync(fixturePath)) mkdirSync(fixturePath)

  const jsonFixturePath = join(fixturePath, "_response.json")
  let response
  if (overwriteInfo || !existsSync(jsonFixturePath)) {
    response = await queryPRInfo(prNumber)
    writeFileSync(jsonFixturePath, JSON.stringify(response, null, "  "))
  } else {
    response = JSON.parse(readFileSync(jsonFixturePath, "utf8"))
  }
  
  const ownersJSONPath = join(fixturePath, "_owners.json")
  const downloadsJSONPath = join(fixturePath, "_downloads.json")
  const derivedFixturePath = join(fixturePath, "derived.json")

  const derivedInfo = await deriveStateForPR(
    response,
    !overwriteInfo && existsSync(ownersJSONPath) ? getOwnersFromFile : fetchOwnersAndWriteToFile,
    !overwriteInfo && existsSync(downloadsJSONPath) ? getDownloadsFromFile : fetchDownloadsAndWriteToFile,
    !overwriteInfo && existsSync(derivedFixturePath) ? getTimeFromFile : undefined,
  );

  writeFileSync(derivedFixturePath, JSON.stringify(derivedInfo, null, "  ")) 
  
  if (derivedInfo.type === "fail") {
    const ownersJSONPath = join(fixturePath, "_owners.json")
    writeFileSync(ownersJSONPath, JSON.stringify({ allOwners: [], anyPackageIsNew: false }, null, "  ")) 
    return
  }

  const resultFixturePath = join(fixturePath, "result.json")
  const actions = computeActions.process(derivedInfo);
  writeFileSync(resultFixturePath, JSON.stringify(actions, null, "  "))

  const mutationsFixturePath = join(fixturePath, "mutations.json")
  const mutations = await executePrActions(actions, response.data, /*dry*/ true)
  writeFileSync(mutationsFixturePath, JSON.stringify(mutations.map(m => JSON.parse(m)), null, "  "))
  
  console.log(`Recorded`);

  async function fetchOwnersAndWriteToFile(packages: readonly string[]) {
    const owners = await getOwnersOfPackages(packages)
    writeFileSync(ownersJSONPath, JSON.stringify(owners, null, "  "))
    return owners
  }

  function getOwnersFromFile() {
    return JSON.parse(readFileSync(ownersJSONPath, "utf8"))
  }

  async function fetchDownloadsAndWriteToFile(packages: readonly string[]) {
    const downloadsPerPackage: Record<string, number> = {}
    for (const packageName of packages) {
      downloadsPerPackage[packageName] = await getMonthlyDownloadCount(packageName)
    }
    writeFileSync(downloadsJSONPath, JSON.stringify(downloadsPerPackage, null, "  "))
    return downloadsPerPackage
  }

  function getDownloadsFromFile(packages: readonly string[]) {
    const downloadsPerPackage = JSON.parse(readFileSync(downloadsJSONPath, "utf8"))
    for (const packageName of packages) {
      assert(packageName in downloadsPerPackage)
    }
    return downloadsPerPackage
  }

  function getTimeFromFile() {
    return new Date(JSON.parse(readFileSync(derivedFixturePath, "utf8")).now);
  }
}


if (!module.parent) {
  const num = process.argv[2]
  const overwriteInfo = process.argv.slice(2).includes("--overwrite-info")
  main(num, overwriteInfo).then(() => {
    process.exit(0)
  })
}
