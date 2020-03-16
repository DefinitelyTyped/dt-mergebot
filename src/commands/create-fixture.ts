import { getPRInfo, queryPRInfo } from "../pr-info";
import * as computeActions from "../compute-pr-actions";
import { render } from "prettyjson";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getOwnersOfPackages } from "../util/getOwnersOfPackages";


async function main() {
  const num = +process.argv[2];
  
  const fixturePath = join("src", "_tests", "fixtures", num + "")

  const response = await queryPRInfo(num);

  const derivedInfo = await getPRInfo(num);

  if(!existsSync(fixturePath)) mkdirSync(fixturePath)

  const jsonFixturePath = join(fixturePath, "_response.json")
  writeFileSync(jsonFixturePath, JSON.stringify(response, null, "  ")) 
  
  const derivedFixturePath = join(fixturePath, "derived.json")
  writeFileSync(derivedFixturePath, JSON.stringify(derivedInfo, null, "  ")) 
  
  if (derivedInfo.type === "fail") {
    return 
  }

  const ownersJSONPath = join(fixturePath, "owners.json")
  const owners = await getOwnersOfPackages(derivedInfo.packages)
  // @ts-ignore
  owners.allOwners = [...owners.allOwners]
  writeFileSync(ownersJSONPath, JSON.stringify(owners, null, "  ")) 

  const resultFixturePath = join(fixturePath, "result.json")
  const actions = computeActions.process(derivedInfo);
  writeFileSync(resultFixturePath, JSON.stringify(actions, null, "  ")) 
  
  console.log(`Recorded`);
}

main().then(() => {
  process.exit(0);
});
