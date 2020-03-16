/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetFileContent
// ====================================================

export interface GetFileContent_repository_object_Commit {
  __typename: "Commit" | "Tree" | "Tag";
}

export interface GetFileContent_repository_object_Blob {
  __typename: "Blob";
  /**
   * UTF8 text data or null if the Blob is binary
   */
  text: string | null;
}

export type GetFileContent_repository_object = GetFileContent_repository_object_Commit | GetFileContent_repository_object_Blob;

export interface GetFileContent_repository {
  __typename: "Repository";
  /**
   * A Git object in the repository
   */
  object: GetFileContent_repository_object | null;
}

export interface GetFileContent {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: GetFileContent_repository | null;
}

export interface GetFileContentVariables {
  owner: string;
  name: string;
  expr: string;
}
