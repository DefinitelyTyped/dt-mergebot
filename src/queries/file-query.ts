import { gql } from "apollo-boost";

export const GetFileContent = gql`query GetFileContent($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Blob {
          text
        }
      }
    }
  }
  `;

export const GetFileExists = gql`query GetFileExists($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Blob {
          id
        }
      }
    }
  }
  `;
