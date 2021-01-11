import { readdirSync, readJsonSync } from "fs-extra";
import { join } from "path";
import { toMatchFile } from "jest-file-snapshot";
import { process } from "../compute-pr-actions";
import { deriveStateForPR, BotResult } from "../pr-info";
import { scrubDiagnosticDetails } from "../util/util";
import * as cachedQueries from "./cachedQueries.json";
jest.mock("../util/cachedQueries", () => ({
  getProjectBoardColumns: jest.fn(() => cachedQueries.getProjectBoardColumns),
  getLabels: jest.fn(() => cachedQueries.getLabels)
}));
import { executePrActions } from "../execute-pr-actions";

expect.extend({ toMatchFile });

/* You can use the following command to add/update fixtures with an existing PR
 *
 *     BOT_AUTH_TOKEN=XYZ npm run create-fixture -- 43164
 */

async function testFixture(dir: string) {
  // _foo.json are input files, except for Date.now from derived.json
  const responsePath = join(dir, "_response.json");
  const filesPath = join(dir, "_files.json");
  const downloadsPath = join(dir, "_downloads.json");
  const derivedPath = join(dir, "derived.json");
  const resultPath = join(dir, "result.json");
  const mutationsPath = join(dir, "mutations.json");

  const JSONString = (value: any) => scrubDiagnosticDetails(JSON.stringify(value, null, "  ") + "\n");

  const response = readJsonSync(responsePath);
  const files = readJsonSync(filesPath);
  const downloads = readJsonSync(downloadsPath);

  const derived = await deriveStateForPR(
    response,
    (expr: string) => Promise.resolve(files[expr] as string),
    (name: string, _until?: Date) => name in downloads ? downloads[name] : 0,
    (readJsonSync(derivedPath) as BotResult).now
  );

  if (derived.type === "fail") throw new Error("Should never happen");

  const action = process(derived);

  expect(JSONString(action)).toMatchFile(resultPath);
  expect(JSONString(derived)).toMatchFile(derivedPath);

  const mutations = await executePrActions(action, response.data, /*dry*/ true);
  expect(JSONString(mutations)).toMatchFile(mutationsPath);
}

describe("Test fixtures", () => {
  const fixturesFolder = join(__dirname, "fixtures");
  readdirSync(fixturesFolder, { withFileTypes: true }).forEach(dirent => {
    if (dirent.isDirectory()) {
      it(`Fixture: ${dirent.name}`, async () => testFixture(join(fixturesFolder, dirent.name)));
    }
  });
});
