const client = require("./bin/graphql-client");
client.mutate("mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }", { "input": { subjectId: "MDU6SXNzdWU1MTM1MjUxNTQ=", body: "Hello world" } }).then(
    ok => { console.log(JSON.stringify(ok, undefined, 2)) },
    err => { throw err; }
);
