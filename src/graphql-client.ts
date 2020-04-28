import fetch from "node-fetch";
import { ApolloClient } from "apollo-boost";
import { InMemoryCache, IntrospectionFragmentMatcher } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';

const headers = {
    authorization: `Bearer ${getAuthToken()}`,
    accept: "application/vnd.github.antiope-preview+json"
};
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

export async function mutate(query: string, input: object) {
    const result = await fetch(uri, {
        method: "POST",
        headers: {
            ...headers,
            "Content-type": "application/json"
        },
        body: JSON.stringify({
            query,
            variables: input
        }, undefined, 2)
    });
    
    return await result.text();
}

function getAuthToken() {
    if (process.env.JEST_WORKER_ID) return "FAKE_TOKEN"

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }
    return result.trim();
}
