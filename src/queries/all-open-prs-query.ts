import { gql, TypedDocumentNode } from "@apollo/client/core";
import { client } from "../graphql-client";
import { GetAllOpenPRsAndCardIDs, GetAllOpenPRsAndCardIDsVariables } from "./schema/GetAllOpenPRsAndCardIDs";
import { noNullish } from "../util/util";

export const getAllOpenPRsAndCardIDsQuery: TypedDocumentNode<GetAllOpenPRsAndCardIDs, GetAllOpenPRsAndCardIDsVariables> = gql`
query GetAllOpenPRsAndCardIDs($endCursor: String) {
  repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
    id
    pullRequests(states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }, first: 100, after: $endCursor) {
      nodes {
        number
        projectCards(first: 100) { nodes { id } }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

export async function getAllOpenPRsAndCardIDs() {
    const prNumbers: number[] = [];
    const cardIDs: string[] = [];
    let endCursor: string | undefined | null;
    while (true) {
        const result = await client.query({
            query: getAllOpenPRsAndCardIDsQuery,
            fetchPolicy: "no-cache",
            variables: { endCursor }
        });
        prNumbers.push(...noNullish(result.data.repository?.pullRequests.nodes).map(pr => pr.number));
        for (const pr of noNullish(result.data.repository?.pullRequests.nodes)) {
            cardIDs.push(...noNullish(pr.projectCards.nodes).map(card => card.id));
        }
        if (!result.data.repository?.pullRequests.pageInfo.hasNextPage) {
            return { prNumbers, cardIDs };
        }
        endCursor = result.data.repository.pullRequests.pageInfo.endCursor;
    }
}
