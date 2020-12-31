import { GetLabels, GetProjectColumns } from "../queries/label-columns-queries";
import { GetProjectColumns as GetProjectColumnsResult } from "../queries/schema/GetProjectColumns";
import { GetLabels as GetLabelsResult } from "../queries/schema/GetLabels";
import { createCache } from "../ttl-cache";
import { client } from "../graphql-client";
import { noNullish } from "./util";

const cache = createCache();

export async function getProjectBoardColumns() {
  return cache.getAsync("project board colum names", Infinity, async () => {
      const res = noNullish((await query<GetProjectColumnsResult>(GetProjectColumns))
          .repository?.project?.columns.nodes);
      return res.sort((a,b) => a.name.localeCompare(b.name));
  });
}

export async function getLabels() {
  return await cache.getAsync("label ids", Infinity, async () => {
      const res = noNullish((await query<GetLabelsResult>(GetLabels))
          .repository?.labels?.nodes);
      return res.sort((a,b) => a.name.localeCompare(b.name));
  });
}

async function query<T>(gql: any): Promise<T> {
  const res = await client.query<T>({
      query: gql,
      fetchPolicy: "network-only",
  });
  return res.data;
}
