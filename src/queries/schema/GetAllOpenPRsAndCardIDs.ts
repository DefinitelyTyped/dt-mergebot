/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetAllOpenPRsAndCardIDs
// ====================================================

export interface GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node_projectCards_nodes {
  __typename: "ProjectCard";
  id: string;
}

export interface GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node_projectCards {
  __typename: "ProjectCardConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node_projectCards_nodes | null)[] | null;
}

export interface GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node {
  __typename: "PullRequest";
  /**
   * Identifies the pull request number.
   */
  number: number;
  /**
   * Identifies the date and time when the object was last updated.
   */
  updatedAt: any;
  /**
   * List of project cards associated with this pull request.
   */
  projectCards: GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node_projectCards;
}

export interface GetAllOpenPRsAndCardIDs_repository_pullRequests_edges {
  __typename: "PullRequestEdge";
  /**
   * A cursor for use in pagination.
   */
  cursor: string;
  /**
   * The item at the end of the edge.
   */
  node: GetAllOpenPRsAndCardIDs_repository_pullRequests_edges_node | null;
}

export interface GetAllOpenPRsAndCardIDs_repository_pullRequests {
  __typename: "PullRequestConnection";
  /**
   * A list of edges.
   */
  edges: (GetAllOpenPRsAndCardIDs_repository_pullRequests_edges | null)[] | null;
}

export interface GetAllOpenPRsAndCardIDs_repository {
  __typename: "Repository";
  /**
   * A list of pull requests that have been opened in the repository.
   */
  pullRequests: GetAllOpenPRsAndCardIDs_repository_pullRequests;
}

export interface GetAllOpenPRsAndCardIDs {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: GetAllOpenPRsAndCardIDs_repository | null;
}

export interface GetAllOpenPRsAndCardIDsVariables {
  after?: string | null;
}
