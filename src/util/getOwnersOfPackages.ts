
import * as HeaderPaser from "definitelytyped-header-parser";
import { client } from "../graphql-client";
import { GetFileContent } from "../file-query";

import { GetFileContent as GetFileContentResult } from "../schema/GetFileContent";

export async function getOwnersOfPackages(packages: readonly string[]) {
  const allOwners = new Set<string>();
  let anyPackageIsNew = false;
  for (const p of packages) {
      const owners = await getOwnersForPackage(p);
      if (owners === undefined) {
          anyPackageIsNew = true;
      } else {
          for (const o of owners) {
              allOwners.add(o);
          }
      }
  }
  return { allOwners, anyPackageIsNew };
}


async function getOwnersForPackage(packageName: string): Promise<string[] | undefined> {
  debugger;
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
