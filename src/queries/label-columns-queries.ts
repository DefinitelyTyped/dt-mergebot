import { gql } from "@apollo/client/core";

export const GetLabels = gql`
query GetLabels {
  repository(name:"DefinitelyTyped", owner:"DefinitelyTyped") {
    id
    labels(first: 100) {
      nodes {
        id
        name
      }
    }
  }
}`;

export const GetProjectColumns = gql`
query GetProjectColumns {
  repository(name:"DefinitelyTyped", owner:"DefinitelyTyped") {
    id
    project(number: 5) {
      id
      columns(first: 30) {
        nodes {
          id
          name
        }
      }
    }
  }
}`;
