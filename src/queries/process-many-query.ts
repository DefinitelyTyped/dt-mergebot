import { gql } from "apollo-boost";
import { client } from "../graphql-client";
import { ProcessManyPRs, ProcessManyPRsVariables } from "./schema/ProcessManyPRs";

/*****************************************************************************************/
/* FIXME: This should be removed and implemented as a function using all-open-prs-query! */
/*****************************************************************************************/

export const GetProcessManyPRs = gql`
query ProcessManyPRs($after: String) {
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

export async function getProcessManyPRs(startTime: Date, endTime?: Date) {
  const prNumbers: number[] = [];
  let after: string | undefined;
  while (true) {
    const results = await client.query<ProcessManyPRs, ProcessManyPRsVariables>({
      query: GetProcessManyPRs,
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

      const updatedAt = new Date(node.updatedAt);
      if (updatedAt < startTime) {
        // We’ve gone all the way past startTime. Everything after this is older
        // than we care about, so we’re done.
        return prNumbers;
      }

      if (startTime <= updatedAt && (!endTime || updatedAt <= endTime)) {
        // This PR is in the range we care about.
        prNumbers.push(node.number);
      }
    }
  }
}
