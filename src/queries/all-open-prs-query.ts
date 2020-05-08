import { gql } from "apollo-boost";
import { client } from "../graphql-client";
import { RecentlyUpdatedPRs, RecentlyUpdatedPRsVariables } from "./schema/RecentlyUpdatedPRs";

export const GetAllOpenPRs = gql`query GetAllOpenPRs($after: String) {
  repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
    pullRequests(orderBy: { field: UPDATED_AT, direction: DESC }, states: [OPEN], first: 100, after: $after) {
      edges {
        cursor
        node {
          number
          updatedAt
        }
      }
    }
  }
}`;

export async function getAllOpenPRs() {
  const prNumbers: number[] = [];
  let after: string | undefined;
  while (true) {
    const results = await client.query<RecentlyUpdatedPRs, RecentlyUpdatedPRsVariables>({
      query: GetAllOpenPRs,
      fetchPolicy: "network-only",
      fetchResults: true,
      variables: { after }
    });

    if (results.errors) {
      throw new Error(results.errors.join('\n'));
    }

    if (!results.data.repository?.pullRequests.edges?.length) {
      return prNumbers;
    }

    for (const edge of results.data.repository.pullRequests.edges) {
      if (!edge) continue;
      const { node, cursor } = edge;
      after = cursor;
      if (!node) continue;

      prNumbers.push(node.number);
    }
  }
}
