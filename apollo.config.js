module.exports = {
    client: {
        service: {
            name: "github",
            headers: {
                authorization: `Bearer ${process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"]}`
            },
            localSchemaFile: "./node_modules/@octokit/graphql-schema/schema.graphql",
            includes: ["./src/pr-query.ts"],
        }
    }
};