import { gql } from "apollo-boost";
import {client} from "../graphql-client"
import {GetPRForStatus} from "./schema/GetPRForStatus"

export const runQueryToGetPRMetadataForStatus = async (query: string) => {
  const info = await client.query<GetPRForStatus>({
      query: GetPRForStatusQuery,
      variables: { query },
      fetchPolicy: "network-only",
      fetchResults: true
  });
  const pr = info && info.data && info.data.search.nodes && info.data.search.nodes[0]
  if (!pr || pr.__typename !== "PullRequest") return undefined

  return pr
}

export const GetPRForStatusQuery = gql`query GetPRForStatus($query: String!) {
  search(query: $query, first: 1, type: ISSUE) {
    nodes {
      ... on PullRequest {
        title
        number
        closed
      }
    }
  }
}`;
