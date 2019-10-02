/* tslint:disable */
/* eslint-disable */
// This file was automatically generated and should not be edited.

import { MergeableState, PullRequestState, PullRequestReviewState, StatusState } from "./../../schema/globalTypes";

// ====================================================
// GraphQL query operation: PR
// ====================================================

export interface PR_repository_pullRequest_author {
  __typename: "Organization" | "User" | "Mannequin" | "Bot";
  /**
   * The username of the actor.
   */
  login: string;
}

export interface PR_repository_pullRequest_baseRef {
  __typename: "Ref";
  /**
   * The ref name.
   */
  name: string;
}

export interface PR_repository_pullRequest_labels_nodes {
  __typename: "Label";
  /**
   * Identifies the label name.
   */
  name: string;
}

export interface PR_repository_pullRequest_labels {
  __typename: "LabelConnection";
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_labels_nodes | null)[] | null;
}

export interface PR_repository_pullRequest_timelineItems_nodes_AddedToProjectEvent {
  __typename: "AddedToProjectEvent" | "AssignedEvent" | "BaseRefChangedEvent" | "BaseRefForcePushedEvent" | "ClosedEvent" | "CommentDeletedEvent" | "ConvertedNoteToIssueEvent" | "CrossReferencedEvent" | "DemilestonedEvent" | "DeployedEvent" | "DeploymentEnvironmentChangedEvent" | "HeadRefDeletedEvent" | "HeadRefForcePushedEvent" | "HeadRefRestoredEvent" | "IssueComment" | "LabeledEvent" | "LockedEvent" | "MarkedAsDuplicateEvent" | "MentionedEvent" | "MergedEvent" | "MilestonedEvent" | "MovedColumnsInProjectEvent" | "PinnedEvent" | "PullRequestCommitCommentThread" | "PullRequestReviewThread" | "PullRequestRevisionMarker" | "ReadyForReviewEvent" | "ReferencedEvent" | "RemovedFromProjectEvent" | "RenamedTitleEvent" | "ReopenedEvent" | "ReviewDismissedEvent" | "ReviewRequestRemovedEvent" | "ReviewRequestedEvent" | "SubscribedEvent" | "TransferredEvent" | "UnassignedEvent" | "UnlabeledEvent" | "UnlockedEvent" | "UnpinnedEvent" | "UnsubscribedEvent" | "UserBlockedEvent";
}

export interface PR_repository_pullRequest_timelineItems_nodes_PullRequestCommit_commit {
  __typename: "Commit";
  /**
   * The Git object ID
   */
  oid: any;
}

export interface PR_repository_pullRequest_timelineItems_nodes_PullRequestCommit {
  __typename: "PullRequestCommit";
  /**
   * The Git commit object
   */
  commit: PR_repository_pullRequest_timelineItems_nodes_PullRequestCommit_commit;
}

export interface PR_repository_pullRequest_timelineItems_nodes_PullRequestReview_author {
  __typename: "Organization" | "User" | "Mannequin" | "Bot";
  /**
   * The username of the actor.
   */
  login: string;
}

export interface PR_repository_pullRequest_timelineItems_nodes_PullRequestReview {
  __typename: "PullRequestReview";
  /**
   * The actor who authored the comment.
   */
  author: PR_repository_pullRequest_timelineItems_nodes_PullRequestReview_author | null;
  /**
   * Identifies the current state of the pull request review.
   */
  state: PullRequestReviewState;
}

export type PR_repository_pullRequest_timelineItems_nodes = PR_repository_pullRequest_timelineItems_nodes_AddedToProjectEvent | PR_repository_pullRequest_timelineItems_nodes_PullRequestCommit | PR_repository_pullRequest_timelineItems_nodes_PullRequestReview;

export interface PR_repository_pullRequest_timelineItems {
  __typename: "PullRequestTimelineItemsConnection";
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_timelineItems_nodes | null)[] | null;
}

export interface PR_repository_pullRequest_reviews_nodes_author {
  __typename: "Organization" | "User" | "Mannequin" | "Bot";
  /**
   * The username of the actor.
   */
  login: string;
}

export interface PR_repository_pullRequest_reviews_nodes {
  __typename: "PullRequestReview";
  /**
   * The actor who authored the comment.
   */
  author: PR_repository_pullRequest_reviews_nodes_author | null;
  /**
   * Identifies the current state of the pull request review.
   */
  state: PullRequestReviewState;
  /**
   * Identifies when the Pull Request Review was submitted
   */
  submittedAt: any | null;
  /**
   * The HTTP URL permalink for this PullRequestReview.
   */
  url: any;
}

export interface PR_repository_pullRequest_reviews {
  __typename: "PullRequestReviewConnection";
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_reviews_nodes | null)[] | null;
}

export interface PR_repository_pullRequest_commits_nodes_commit_status_contexts_creator {
  __typename: "Organization" | "User" | "Mannequin" | "Bot";
  /**
   * The username of the actor.
   */
  login: string;
}

export interface PR_repository_pullRequest_commits_nodes_commit_status_contexts {
  __typename: "StatusContext";
  /**
   * The state of this status context.
   */
  state: StatusState;
  /**
   * The description for this status context.
   */
  description: string | null;
  /**
   * The actor who created this status context.
   */
  creator: PR_repository_pullRequest_commits_nodes_commit_status_contexts_creator | null;
  /**
   * The URL for this status context.
   */
  targetUrl: any | null;
}

export interface PR_repository_pullRequest_commits_nodes_commit_status {
  __typename: "Status";
  /**
   * The combined commit status.
   */
  state: StatusState;
  /**
   * The individual status contexts for this commit.
   */
  contexts: PR_repository_pullRequest_commits_nodes_commit_status_contexts[];
}

export interface PR_repository_pullRequest_commits_nodes_commit {
  __typename: "Commit";
  /**
   * Status information for this commit
   */
  status: PR_repository_pullRequest_commits_nodes_commit_status | null;
  /**
   * The datetime when this commit was authored.
   */
  authoredDate: any;
  /**
   * The datetime when this commit was committed.
   */
  committedDate: any;
  /**
   * The datetime when this commit was pushed.
   */
  pushedDate: any | null;
  /**
   * An abbreviated version of the Git object ID
   */
  abbreviatedOid: string;
  /**
   * The Git object ID
   */
  oid: any;
}

export interface PR_repository_pullRequest_commits_nodes {
  __typename: "PullRequestCommit";
  /**
   * The Git commit object
   */
  commit: PR_repository_pullRequest_commits_nodes_commit;
}

export interface PR_repository_pullRequest_commits {
  __typename: "PullRequestCommitConnection";
  /**
   * Identifies the total count of items in the connection.
   */
  totalCount: number;
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_commits_nodes | null)[] | null;
}

export interface PR_repository_pullRequest_comments_nodes_author {
  __typename: "Organization" | "User" | "Mannequin" | "Bot";
  /**
   * The username of the actor.
   */
  login: string;
}

export interface PR_repository_pullRequest_comments_nodes {
  __typename: "IssueComment";
  /**
   * The actor who authored the comment.
   */
  author: PR_repository_pullRequest_comments_nodes_author | null;
  /**
   * The body as Markdown.
   */
  body: string;
  /**
   * Identifies the date and time when the object was created.
   */
  createdAt: any;
}

export interface PR_repository_pullRequest_comments {
  __typename: "IssueCommentConnection";
  /**
   * Identifies the total count of items in the connection.
   */
  totalCount: number;
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_comments_nodes | null)[] | null;
}

export interface PR_repository_pullRequest_files_nodes {
  __typename: "PullRequestChangedFile";
  /**
   * The path of the file.
   */
  path: string;
  /**
   * The number of additions to the file.
   */
  additions: number;
  /**
   * The number of deletions to the file.
   */
  deletions: number;
}

export interface PR_repository_pullRequest_files {
  __typename: "PullRequestChangedFileConnection";
  /**
   * A list of nodes.
   */
  nodes: (PR_repository_pullRequest_files_nodes | null)[] | null;
}

export interface PR_repository_pullRequest {
  __typename: "PullRequest";
  /**
   * Identifies the pull request title.
   */
  title: string;
  /**
   * The moment the editor made the last edit
   */
  lastEditedAt: any | null;
  /**
   * The actor who authored the comment.
   */
  author: PR_repository_pullRequest_author | null;
  /**
   * Identifies the base Ref associated with the pull request.
   */
  baseRef: PR_repository_pullRequest_baseRef | null;
  /**
   * The number of changed files in this pull request.
   */
  changedFiles: number;
  /**
   * Identifies the date and time when the object was created.
   */
  createdAt: any;
  /**
   * A list of labels associated with the object.
   */
  labels: PR_repository_pullRequest_labels | null;
  /**
   * Whether or not the pull request can be merged based on the existence of merge conflicts.
   */
  mergeable: MergeableState;
  /**
   * Identifies the pull request number.
   */
  number: number;
  /**
   * Identifies the state of the pull request.
   */
  state: PullRequestState;
  /**
   * Identifies the oid of the head ref associated with the pull request, even if the ref has been deleted.
   */
  headRefOid: any;
  /**
   * A list of events, comments, commits, etc. associated with the pull request.
   */
  timelineItems: PR_repository_pullRequest_timelineItems;
  /**
   * A list of reviews associated with the pull request.
   */
  reviews: PR_repository_pullRequest_reviews | null;
  /**
   * A list of commits present in this pull request's head branch not present in the base branch.
   */
  commits: PR_repository_pullRequest_commits;
  /**
   * A list of comments associated with the pull request.
   */
  comments: PR_repository_pullRequest_comments;
  /**
   * Lists the files changed within this pull request.
   */
  files: PR_repository_pullRequest_files | null;
}

export interface PR_repository {
  __typename: "Repository";
  /**
   * Returns a single pull request from the current repository by number.
   */
  pullRequest: PR_repository_pullRequest | null;
}

export interface PR {
  /**
   * Lookup a given repository by the owner and repository name.
   */
  repository: PR_repository | null;
}

export interface PRVariables {
  pr_number: number;
}
