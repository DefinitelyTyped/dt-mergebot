import { readdirSync, readFileSync, lstatSync } from 'fs'
import { join } from 'path'
import { toMatchFile } from 'jest-file-snapshot'
import { process } from '../compute-pr-actions'
import { deriveStateForPR } from '../pr-info'
import * as cachedQueries from './cachedQueries.json';
jest.mock("../util/cachedQueries", () => ({
  getProjectBoardColumns: jest.fn(() => cachedQueries.getProjectBoardColumns),
  getLabels: jest.fn(() => cachedQueries.getLabels)
}))
import { executePrActions } from '../execute-pr-actions';

expect.extend({ toMatchFile })

/* You can use the following command to add/update fixtures with an existing PR
  
  env BOT_AUTH_TOKEN=XYZ npm run create-fixture -- 43164

.*/

// TODO: The process function uses date.now and we will need to mock that per test

describe('with fixtures', () => {
  const fixturesFolder = join(__dirname, 'fixtures')

  readdirSync(fixturesFolder).forEach(fixtureName => {
    const fixture = join(fixturesFolder, fixtureName)
    if (!lstatSync(fixture).isDirectory()) {
      return
    }

    it('Fixture: ' + fixtureName, async () => {
      const responseJSONPath = join(fixture, "_response.json")
      const ownersJSONPath = join(fixture, "_owners.json")
      const downloadsJSONPath = join(fixture, "_downloads.json")
      const derivedJSONPath = join(fixture, "derived.json")
      const actionJSONPath = join(fixture, "result.json")
      const mutationsPath = join(fixture, "mutations.json")

      const response = JSON.parse(readFileSync(responseJSONPath, "utf8"))

      // Because Owners is another API call, we need to make it a fixture also
      // and so this fixture overrides the current
      const derived = await deriveStateForPR(
        response,
        () => JSON.parse(readFileSync(ownersJSONPath, "utf8")),
        () => JSON.parse(readFileSync(downloadsJSONPath, "utf8"))
      )

      if (derived.type === "fail") throw new Error("Should never happen")
      if (derived.type === "noop") {
        expect(JSON.stringify(derived, null, "  ")).toMatchFile(actionJSONPath)
        return
      }

      // So that fixtures don't change per day
      const existingDerivedJSON = JSON.parse(readFileSync(derivedJSONPath, "utf8"))
      // @ts-ignore
      derived.stalenessInDays = existingDerivedJSON.stalenessInDays

      const action = process(derived)

      expect(JSON.stringify(action, null, "  ")).toMatchFile(actionJSONPath)
      expect(JSON.stringify(derived, null, "  ")).toMatchFile(derivedJSONPath)

      const mutations = await executePrActions(action, response.data, /*dry*/ true)
      expect(JSON.stringify(mutations.map(m => JSON.parse(m)), null, "  ")).toMatchFile(mutationsPath)
    })
  })
})
