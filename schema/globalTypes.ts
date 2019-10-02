/* tslint:disable */
/* eslint-disable */
// This file was automatically generated and should not be edited.

//==============================================================
// START Enums and Input Objects
//==============================================================

/**
 * Whether or not a PullRequest can be merged.
 */
export enum MergeableState {
  CONFLICTING = "CONFLICTING",
  MERGEABLE = "MERGEABLE",
  UNKNOWN = "UNKNOWN",
}

/**
 * The possible states of a pull request review.
 */
export enum PullRequestReviewState {
  APPROVED = "APPROVED",
  CHANGES_REQUESTED = "CHANGES_REQUESTED",
  COMMENTED = "COMMENTED",
  DISMISSED = "DISMISSED",
  PENDING = "PENDING",
}

/**
 * The possible states of a pull request.
 */
export enum PullRequestState {
  CLOSED = "CLOSED",
  MERGED = "MERGED",
  OPEN = "OPEN",
}

/**
 * The possible commit status states.
 */
export enum StatusState {
  ERROR = "ERROR",
  EXPECTED = "EXPECTED",
  FAILURE = "FAILURE",
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
}

//==============================================================
// END Enums and Input Objects
//==============================================================
