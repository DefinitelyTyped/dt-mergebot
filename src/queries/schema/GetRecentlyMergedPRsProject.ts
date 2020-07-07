/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetRecentlyMergedPRsProject
// ====================================================

export interface GetRecentlyMergedPRsProject_repository_project_columns_nodes_cards_nodes {
  __typename: "ProjectCard";
  id: string;
  /**
   * Identifies the date and time when the object was last updated.
   */
  updatedAt: any;
}

export interface GetRecentlyMergedPRsProject_repository_project_columns_nodes_cards {
  __typename: "ProjectCardConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetRecentlyMergedPRsProject_repository_project_columns_nodes_cards_nodes | null)[] | null;
}

export interface GetRecentlyMergedPRsProject_repository_project_columns_nodes {
  __typename: "ProjectColumn";
  id: string;
  /**
   * The project column's name.
   */
  name: string;
  /**
   * List of cards in the column
   */
  cards: GetRecentlyMergedPRsProject_repository_project_columns_nodes_cards;
}

export interface GetRecentlyMergedPRsProject_repository_project_columns {
  __typename: "ProjectColumnConnection";
  /**
   * A list of nodes.
   */
  nodes: (GetRecentlyMergedPRsProject_repository_project_columns_nodes | null)[] | null;
}

export interface GetRecentlyMergedPRsProject_repository_project {
  __typename: "Project";
  id: string;
  /**
   * List of columns in the project
   */
  columns: GetRecentlyMergedPRsProject_repository_project_columns;
}

export interface GetRecentlyMergedPRsProject_repository {
  __typename: "Repository";
  id: string;
  /**
   * Find project by number.
   */
  project: GetRecentlyMergedPRsProject_repository_project | null;
}

export interface GetRecentlyMergedPRsProject {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: GetRecentlyMergedPRsProject_repository | null;
}
