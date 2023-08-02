import fetch from "node-fetch";
import { ApolloClient, gql, HttpLink, InMemoryCache, MutationOptions, TypedDocumentNode } from "@apollo/client/core";
import { print } from "graphql";
import * as schema from "@octokit/graphql-schema/schema";
import { getAuthToken } from "./auth";

// get the values directly from the apollo config
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apolloCfg = require("../apollo.config.js").client.service;

const uri = apolloCfg.url;
const headers = {
    ...apolloCfg.headers,
    authorization: `Bearer ${getAuthToken()}`,
};

const cache = new InMemoryCache();
const link = new HttpLink({ uri, headers, fetch });

export const client = new ApolloClient({ cache, link });

export function createMutation<T>(name: keyof schema.Mutation, input: T, subquery?: string): MutationOptions<void, { input: T }> {
    const mutation = {
        toJSON: () => print(mutation),
        ...(gql`mutation($input: ${name[0]!.toUpperCase() + name.slice(1)}Input!) {
                    ${name}(input: $input) {
                        __typename
                        ${subquery || ""}
                    }
                }` as TypedDocumentNode<void, { input: T }>),
    };
    return { mutation, variables: { input } };
}
