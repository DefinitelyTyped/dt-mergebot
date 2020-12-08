import fetch, { RequestInit } from "node-fetch";
import { ApolloClient } from "apollo-boost";
import { InMemoryCache, IntrospectionFragmentMatcher } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';

export interface Mutation extends RequestInit {
    method: "POST";
    headers: {
        authorization: string;
        accept: "application/vnd.github.antiope-preview+json";
        "Content-type": "application/json";
    };
    body: string;
}

const headers = {
    authorization: `Bearer ${getAuthToken()}`,
    accept: "application/vnd.github.antiope-preview+json"
} as const;

const uri = "https://api.github.com/graphql";

const fragmentMatcher = new IntrospectionFragmentMatcher({
    introspectionQueryResultData: {
        __schema: {
            types: []
        }
    }
});
const cache = new InMemoryCache({ fragmentMatcher });
const link = new HttpLink({
    uri,
    headers,
    fetch
});

export const client = new ApolloClient({ cache, link, defaultOptions: {
    query: {
      errorPolicy: "all"
    }
  }
});

export async function mutate(mutation: Mutation) {
    const result = await fetch(uri, mutation);
    return await result.text();
}

export function createMutation(query: string, input: unknown): Mutation {
    return {
        method: "POST",
        headers: {
            ...headers,
            "Content-type": "application/json"
        },
        body: JSON.stringify({
            query,
            variables: input
        }, undefined, 2)
    };
}

function getAuthToken() {
    if (process.env.JEST_WORKER_ID) return "FAKE_TOKEN"

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }
    return result.trim();
}
