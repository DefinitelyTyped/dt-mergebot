/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetQuery
// ====================================================

export interface GetQuery_search_nodes_App {
  __typename: "App" | "Issue" | "MarketplaceListing" | "Organization" | "Repository" | "User";
}

export interface GetQuery_search_nodes_PullRequest {
  __typename: "PullRequest";
  /**
   * Identifies the pull request title.
   */
  title: string;
  /**
   * Identifies the pull request number.
   */
  number: number;
}

export type GetQuery_search_nodes = GetQuery_search_nodes_App | GetQuery_search_nodes_PullRequest;

export interface GetQuery_search {
  __typename: "SearchResultItemConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetQuery_search_nodes | null)[] | null;
}

export interface GetQuery {
  /**
   * Perform a search across resources.
   */
  search: GetQuery_search;
}

export interface GetQueryVariables {
  query: string;
}
