/* tslint:disable */
/* eslint-disable */
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: GetFileExists
// ====================================================

export interface GetFileExists_repository_object_Commit {
  __typename: "Commit" | "Tree" | "Tag";
}

export interface GetFileExists_repository_object_Blob {
  __typename: "Blob";
  id: string;
}

export type GetFileExists_repository_object = GetFileExists_repository_object_Commit | GetFileExists_repository_object_Blob;

export interface GetFileExists_repository {
  __typename: "Repository";
  /**
   * A Git object in the repository
   */
  object: GetFileExists_repository_object | null;
}

export interface GetFileExists {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: GetFileExists_repository | null;
}

export interface GetFileExistsVariables {
  owner: string;
  name: string;
  expr: string;
}
