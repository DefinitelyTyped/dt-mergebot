import { gql, TypedDocumentNode } from "@apollo/client/core";
import { PR, PRVariables } from "./schema/PR";

// Note: If you want to work on this in a copy of GraphiQL (the IDE-like for GraphQL)
// - You will need to download the electron app: https://github.com/skevy/graphiql-app
// - Then set the two headers:
//    accept: application/vnd.github.antiope-preview+json
//    authorization: Bearer [token]
// - Finally set the endpoint: https://api.github.com/graphql
// - Now you're good to C&P the query below

/** This is a GraphQL AST tree */
export const GetPRInfo: TypedDocumentNode<PR, PRVariables> = gql`
query PR($pr_number: Int!) {
    repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
      id
      pullRequest(number: $pr_number) {
        id
        title
        createdAt
        author {
          login
        }
        authorAssociation
        baseRef {
          name
        }
        labels(first: 100) {
          nodes {
            name
          }
        }
        isDraft
        mergeable
        number
        state
        headRefOid

        timelineItems(last: 200, itemTypes: [REOPENED_EVENT, READY_FOR_REVIEW_EVENT,
                                             MOVED_COLUMNS_IN_PROJECT_EVENT]) {
          nodes {
            ... on ReopenedEvent {
              createdAt
            }
            ... on ReadyForReviewEvent {
              createdAt
            }
            ... on MovedColumnsInProjectEvent {
              actor { login }
              createdAt
            }
          }
        }

        reviews(last: 100) {
          nodes {
            author {
              login
            }
            commit {
              oid
            }
            comments(last: 10) {
              nodes {
                author {
                  login
                }
                createdAt
              }
            }
            authorAssociation
            state
            submittedAt
            url
          }
        }

        commits(last: 100) {
          totalCount
          nodes {
            commit {
              checkSuites(first: 100) {
                nodes {
                  app {
                    name
                  }
                  conclusion
                  resourcePath
                  status
                  url
                }
              }
              status {
                state
                contexts {
                  state
                  description
                  creator { login }
                  targetUrl
                }
              }
              authoredDate
              committedDate
              pushedDate
              oid
            }
          }
        }

        comments(last: 100) {
          totalCount
          nodes {
            id
            author {
              login
            }
            body
            createdAt
            reactions(first: 100, content: THUMBS_UP) {
              nodes {
                user { login }
              }
            }
          }
        }

        files(first: 100) {
          totalCount
          nodes {
            path
            additions
            deletions
          }
        }

        projectCards(first: 10) {
          nodes {
            id
            project {
              id
              number
              name
            }
            column {
              id
              name
            }
          }
        }

      }
    }
  }
  `;
