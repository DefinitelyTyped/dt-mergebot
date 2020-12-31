import { TypedDocumentNode } from "@apollo/client/core";
import { GetLabels, GetProjectColumns } from "../queries/label-columns-queries";
import { createCache } from "../ttl-cache";
import { client } from "../graphql-client";
import { noNullish } from "./util";

const cache = createCache();

export async function getProjectBoardColumns() {
  return cache.getAsync("project board colum names", Infinity, async () => {
      const res = noNullish((await query(GetProjectColumns))
          .repository?.project?.columns.nodes);
      return res.sort((a,b) => a.name.localeCompare(b.name));
  });
}

export async function getLabels() {
  return await cache.getAsync("label ids", Infinity, async () => {
      const res = noNullish((await query(GetLabels))
          .repository?.labels?.nodes);
      return res.sort((a,b) => a.name.localeCompare(b.name));
  });
}

async function query<T>(gql: TypedDocumentNode<T>): Promise<T> {
  const res = await client.query({
      query: gql,
      fetchPolicy: "network-only",
  });
  return res.data;
}
