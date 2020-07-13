import { gql } from "apollo-boost";

export const GetLabels = gql`
query GetLabels {
  repository(name:"DefinitelyTyped", owner:"DefinitelyTyped") {
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
