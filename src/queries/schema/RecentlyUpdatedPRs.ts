/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: RecentlyUpdatedPRs
// ====================================================

export interface RecentlyUpdatedPRs_repository_pullRequests_edges_node {
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

export interface RecentlyUpdatedPRs_repository_pullRequests_edges {
  __typename: "PullRequestEdge";
  /**
   * A cursor for use in pagination.
   */
  cursor: string;
  /**
   * The item at the end of the edge.
   */
  node: RecentlyUpdatedPRs_repository_pullRequests_edges_node | null;
}

export interface RecentlyUpdatedPRs_repository_pullRequests {
  __typename: "PullRequestConnection";
  /**
   * A list of edges.
   */
  edges: (RecentlyUpdatedPRs_repository_pullRequests_edges | null)[] | null;
}

export interface RecentlyUpdatedPRs_repository {
  __typename: "Repository";
  /**
   * A list of pull requests that have been opened in the repository.
   */
  pullRequests: RecentlyUpdatedPRs_repository_pullRequests;
}

export interface RecentlyUpdatedPRs {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: RecentlyUpdatedPRs_repository | null;
}

export interface RecentlyUpdatedPRsVariables {
  after?: string | null;
}
