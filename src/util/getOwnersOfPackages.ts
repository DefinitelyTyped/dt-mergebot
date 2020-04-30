// These functions were moved out into their own
// file so that it's easy to isolate the async networking 
// in tests

import * as HeaderPaser from "definitelytyped-header-parser";
import { client } from "../graphql-client";
import { GetFileContent } from "../queries/file-query";

import { GetFileContent as GetFileContentResult } from "../queries/schema/GetFileContent";

export interface OwnerInfo {
    anyPackageIsNew: boolean;
    allOwners: string[];
}

export async function getOwnersOfPackages(packages: readonly string[]): Promise<OwnerInfo> {
  const allOwners = [];
  let anyPackageIsNew = false;
  for (const p of packages) {
      const owners = await getOwnersForPackage(p);
      if (owners === undefined) {
          anyPackageIsNew = true;
      } else {
          for (const o of owners) {
              if (!owners.includes(o)) {
                allOwners.push(o);
              }
          }
      }
  }
  return { allOwners, anyPackageIsNew };
}


async function getOwnersForPackage(packageName: string): Promise<string[] | undefined> {
  const indexDts = `master:types/${packageName}/index.d.ts`;
  const indexDtsContent = await fetchFile(indexDts);
  if (indexDtsContent === undefined) return undefined;

  try {
      const parsed = HeaderPaser.parseHeaderOrFail(indexDtsContent);
      return parsed.contributors.map(c => c.githubUsername).filter(notUndefined);
  } catch(e) {
      console.error(e);
      return undefined;
  }
}

async function fetchFile(expr: string): Promise<string | undefined> {
  const info = await client.query<GetFileContentResult>({
      query: GetFileContent,
      variables: {
          name: "DefinitelyTyped",
          owner: "DefinitelyTyped",
          expr: `${expr}`
      }
  });

  if (info.data.repository?.object?.__typename === "Blob") {
      return info.data.repository.object.text ?? undefined;
  }
  return undefined;
}

function notUndefined<T>(arg: T | undefined): arg is T { return arg !== undefined; }
