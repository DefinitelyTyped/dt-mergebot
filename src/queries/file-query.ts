import { gql } from "@apollo/client/core";

export const GetFileContent = gql`
  query GetFileContent($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      id
      object(expression: $expr) {
        ... on Blob {
          text
          byteSize
        }
      }
    }
  }`;
