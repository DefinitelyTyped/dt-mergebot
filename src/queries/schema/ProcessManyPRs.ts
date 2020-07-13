/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: ProcessManyPRs
// ====================================================

export interface ProcessManyPRs_repository_pullRequests_edges_node {
  __typename: "PullRequest";
  /**
   * Identifies the pull request number.
   */
  number: number;
  /**
   * Identifies the date and time when the object was last updated.
   */
  updatedAt: any;
}

export interface ProcessManyPRs_repository_pullRequests_edges {
  __typename: "PullRequestEdge";
  /**
   * A cursor for use in pagination.
   */
  cursor: string;
  /**
   * The item at the end of the edge.
   */
  node: ProcessManyPRs_repository_pullRequests_edges_node | null;
}

export interface ProcessManyPRs_repository_pullRequests {
  __typename: "PullRequestConnection";
  /**
   * A list of edges.
   */
  edges: (ProcessManyPRs_repository_pullRequests_edges | null)[] | null;
}

export interface ProcessManyPRs_repository {
  __typename: "Repository";
  /**
   * A list of pull requests that have been opened in the repository.
   */
  pullRequests: ProcessManyPRs_repository_pullRequests;
}

export interface ProcessManyPRs {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: ProcessManyPRs_repository | null;
}

export interface ProcessManyPRsVariables {
  after?: string | null;
}
