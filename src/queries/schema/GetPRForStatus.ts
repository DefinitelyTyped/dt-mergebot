/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetPRForStatus
// ====================================================

export interface GetPRForStatus_search_nodes_App {
  __typename: "App" | "Issue" | "MarketplaceListing" | "Organization" | "Repository" | "User";
}

export interface GetPRForStatus_search_nodes_PullRequest {
  __typename: "PullRequest";
  /**
   * Identifies the pull request title.
   */
  title: string;
  /**
   * Identifies the pull request number.
   */
  number: number;
  /**
   * `true` if the pull request is closed
   */
  closed: boolean;
}

export type GetPRForStatus_search_nodes = GetPRForStatus_search_nodes_App | GetPRForStatus_search_nodes_PullRequest;

export interface GetPRForStatus_search {
  __typename: "SearchResultItemConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetPRForStatus_search_nodes | null)[] | null;
}

export interface GetPRForStatus {
  /**
   * Perform a search across resources.
   */
  search: GetPRForStatus_search;
}

export interface GetPRForStatusVariables {
  query: string;
}
