import { gql } from "apollo-boost";

// Note: If you want to work on this in a copy of GraphiQL (the IDE-like for GraphQL)
// - You will need to download the electron app: https://github.com/skevy/graphiql-app
// - Then set the two headers:
//    accept: application/vnd.github.antiope-preview+json
//    authorization: Bearer [token]
// - Finally set the endpoint: https://api.github.com/graphql
// - Now you're good to C&P the query below

/** This is a GraphQL AST tree */
export const GetPRInfo = gql`query PR($pr_number: Int!) {
    repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
      pullRequest(number: $pr_number) {
        id
        title
        lastEditedAt
        author {
          login
        }
        authorAssociation
        baseRef {
          name
        }
        changedFiles
        createdAt
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
        
        timelineItems(first: 100, itemTypes:[PULL_REQUEST_COMMIT, PULL_REQUEST_REVIEW, PULL_REQUEST_REVIEW_THREAD, ISSUE_COMMENT]) {
          nodes {
            __typename
            ... on PullRequestCommit {
              commit { oid }
            }
            ... on PullRequestReview {
              author { login }
              state
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
              abbreviatedOid
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
              abbreviatedOid
              oid
            }
          }
        }

        comments(first: 100) {
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
