import { gql } from "@apollo/client/core";
import { client } from "../graphql-client";
import { PullRequestState } from "./schema/graphql-global-types";
import { CardIdToPr } from "./schema/CardIdToPr";

interface CardPRInfo {
    number: number;
    state: PullRequestState;
}

export const runQueryToGetPRForCardId = async (id: string): Promise<CardPRInfo | undefined> => {
    const info = await client.query<CardIdToPr>({
        query: gql`
            query CardIdToPr($id: ID!) {
                node(id: $id) {
                    ... on ProjectCard { content { ... on PullRequest { state number } } }
                }
            }`,
        variables: { id },
        fetchPolicy: "network-only",
    });
    const node = info.data.node;
    return (node?.__typename === "ProjectCard" && node.content?.__typename === "PullRequest")
        ? { number: node.content.number, state: node.content.state }
        : undefined;
}
