import { gql, TypedDocumentNode } from "@apollo/client/core";
import { client } from "../graphql-client";
import { GetAllOpenPRs, GetAllOpenPRsVariables } from "./schema/GetAllOpenPRs";
import { noNullish } from "../util/util";

export const getAllOpenPRsQuery: TypedDocumentNode<GetAllOpenPRs, GetAllOpenPRsVariables> = gql`
query GetAllOpenPRs($endCursor: String) {
  repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
    id
    pullRequests(states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }, first: 100, after: $endCursor) {
      nodes {
        number
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

export async function getAllOpenPRs() {
    const prNumbers: number[] = [];
    let endCursor: string | undefined | null;
    while (true) {
        const result = await client.query({
            query: getAllOpenPRsQuery,
            fetchPolicy: "no-cache",
            variables: { endCursor },
        });
        prNumbers.push(...noNullish(result.data.repository?.pullRequests.nodes).map(pr => pr.number));
        if (!result.data.repository?.pullRequests.pageInfo.hasNextPage) {
            return prNumbers;
        }
        endCursor = result.data.repository.pullRequests.pageInfo.endCursor;
    }
}
