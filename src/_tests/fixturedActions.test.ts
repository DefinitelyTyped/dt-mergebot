import { readdirSync, readFileSync, lstatSync } from 'fs'
import { join } from 'path'
import { toMatchFile } from 'jest-file-snapshot'
import { process } from '../compute-pr-actions'
import { deriveStateForPR } from '../pr-info'
jest.mock("../util/getOwnersOfPackages", () => ({getOwnersOfPackages: jest.fn() }))
import { getOwnersOfPackages } from '../util/getOwnersOfPackages'
const mockOwners = getOwnersOfPackages as any as jest.Mock


jest.mock("../util/npm", () => ({getMonthlyDownloadCount: jest.fn() }))
import { getMonthlyDownloadCount } from '../util/npm'
const mockNPMDownloads = getMonthlyDownloadCount as any as jest.Mock

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
      const derivedJSONPath = join(fixture, "derived.json")
      const ownersJSONPath = join(fixture, "owners.json")
      const actionJSONPath = join(fixture, "result.json")
      
      const response = JSON.parse(readFileSync(responseJSONPath, "utf8"))
         if (fixtureName === "43235") {
          // debugger
          }
          
          // Because Owners is another API call, we need to make it a fixture also
          // and so this fixture overrides the current
          const owners = JSON.parse(readFileSync(ownersJSONPath, "utf8"))
          owners.allOwners = new Set(owners.allOwners)
          mockOwners.mockResolvedValueOnce(owners)

          mockNPMDownloads.mockResolvedValueOnce(123)
          
          const derived = await deriveStateForPR(response)

          if (derived.type === "fail") throw new Error("Should never happen")
          if (derived.type === "noop") {
            expect(JSON.stringify(derived, null, "  ")).toMatchFile(actionJSONPath)
            return
          }
          
          // So that fixtures don't change per day
          const existingDerivedJSON = JSON.parse(readFileSync(derivedJSONPath, "utf8"))
          // @ts-ignore
          derived.stalenessInDays =  existingDerivedJSON.stalenessInDays
          
          const action = process(derived)
          
          expect(JSON.stringify(action, null, "  ")).toMatchFile(actionJSONPath)
          expect(JSON.stringify(derived, null, "  ")).toMatchFile(derivedJSONPath)
        })
    })
})
