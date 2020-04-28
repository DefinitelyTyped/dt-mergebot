/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetLabels
// ====================================================

export interface GetLabels_repository_labels_nodes {
  __typename: "Label";
  id: string;
  /**
   * Identifies the label name.
   */
  name: string;
}

export interface GetLabels_repository_labels {
  __typename: "LabelConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetLabels_repository_labels_nodes | null)[] | null;
}

export interface GetLabels_repository {
  __typename: "Repository";
  /**
   * A list of labels associated with the repository.
   */
  labels: GetLabels_repository_labels | null;
}

export interface GetLabels {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: GetLabels_repository | null;
}
