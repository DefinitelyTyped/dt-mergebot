module.exports = {
    client: {
        service: {
            name: "github",
            url: 'https://api.github.com/graphql',
            headers: {
                authorization: `Bearer ${process.env["DT_BOT_AUTH_TOKEN"] || process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"]}`,
                accept: "application/vnd.github.antiope-preview+json"
            },
            includes: ["./src/queries"],
        }
    }
};
