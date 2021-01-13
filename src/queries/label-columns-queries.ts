import { gql, TypedDocumentNode } from "@apollo/client/core";
import { GetLabels } from "./schema/GetLabels";
import { GetProjectColumns } from "./schema/GetProjectColumns";

export { GetLabels, GetProjectColumns };

const GetLabels: TypedDocumentNode<GetLabels, never> = gql`
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

const GetProjectColumns: TypedDocumentNode<GetProjectColumns, never> = gql`
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
