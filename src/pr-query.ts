import { gql } from "apollo-boost";

export const GetPRInfo = gql`query PR($pr_number: Int!) {
    repository(owner: "DefinitelyTyped", name: "DefinitelyTyped") {
      pullRequest(number: $pr_number) {
        title
        lastEditedAt
        author {
          login
        }
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
        reviews(first: 100) {
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
            author {
              login
            }
            body
            createdAt
            reactions(content: THUMBS_UP) {
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
      }
    }
  }
  `;
