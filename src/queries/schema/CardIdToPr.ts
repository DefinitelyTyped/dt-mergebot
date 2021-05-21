/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

import { PullRequestState } from "./graphql-global-types";

// ====================================================
// GraphQL query operation: CardIdToPr
// ====================================================

export interface CardIdToPr_node_AddedToProjectEvent {
  __typename: "AddedToProjectEvent" | "App" | "AssignedEvent" | "AutoMergeDisabledEvent" | "AutoMergeEnabledEvent" | "AutoRebaseEnabledEvent" | "AutoSquashEnabledEvent" | "AutomaticBaseChangeFailedEvent" | "AutomaticBaseChangeSucceededEvent" | "BaseRefChangedEvent" | "BaseRefDeletedEvent" | "BaseRefForcePushedEvent" | "Blob" | "Bot" | "BranchProtectionRule" | "CWE" | "CheckRun" | "CheckSuite" | "ClosedEvent" | "CodeOfConduct" | "CommentDeletedEvent" | "Commit" | "CommitComment" | "CommitCommentThread" | "ConnectedEvent" | "ConvertToDraftEvent" | "ConvertedNoteToIssueEvent" | "CrossReferencedEvent" | "DemilestonedEvent" | "DeployKey" | "DeployedEvent" | "Deployment" | "DeploymentEnvironmentChangedEvent" | "DeploymentStatus" | "DisconnectedEvent" | "Enterprise" | "EnterpriseAdministratorInvitation" | "EnterpriseIdentityProvider" | "EnterpriseRepositoryInfo" | "EnterpriseServerInstallation" | "EnterpriseServerUserAccount" | "EnterpriseServerUserAccountEmail" | "EnterpriseServerUserAccountsUpload" | "EnterpriseUserAccount" | "ExternalIdentity" | "Gist" | "GistComment" | "HeadRefDeletedEvent" | "HeadRefForcePushedEvent" | "HeadRefRestoredEvent" | "IpAllowListEntry" | "Issue" | "IssueComment" | "Label" | "LabeledEvent" | "Language" | "License" | "LockedEvent" | "Mannequin" | "MarkedAsDuplicateEvent" | "MarketplaceCategory" | "MarketplaceListing" | "MembersCanDeleteReposClearAuditEntry" | "MembersCanDeleteReposDisableAuditEntry" | "MembersCanDeleteReposEnableAuditEntry" | "MentionedEvent" | "MergedEvent" | "Milestone" | "MilestonedEvent" | "MovedColumnsInProjectEvent" | "OauthApplicationCreateAuditEntry" | "OrgAddBillingManagerAuditEntry" | "OrgAddMemberAuditEntry" | "OrgBlockUserAuditEntry" | "OrgConfigDisableCollaboratorsOnlyAuditEntry" | "OrgConfigEnableCollaboratorsOnlyAuditEntry" | "OrgCreateAuditEntry" | "OrgDisableOauthAppRestrictionsAuditEntry" | "OrgDisableSamlAuditEntry" | "OrgDisableTwoFactorRequirementAuditEntry" | "OrgEnableOauthAppRestrictionsAuditEntry" | "OrgEnableSamlAuditEntry" | "OrgEnableTwoFactorRequirementAuditEntry" | "OrgInviteMemberAuditEntry" | "OrgInviteToBusinessAuditEntry" | "OrgOauthAppAccessApprovedAuditEntry" | "OrgOauthAppAccessDeniedAuditEntry" | "OrgOauthAppAccessRequestedAuditEntry" | "OrgRemoveBillingManagerAuditEntry" | "OrgRemoveMemberAuditEntry" | "OrgRemoveOutsideCollaboratorAuditEntry" | "OrgRestoreMemberAuditEntry" | "OrgUnblockUserAuditEntry" | "OrgUpdateDefaultRepositoryPermissionAuditEntry" | "OrgUpdateMemberAuditEntry" | "OrgUpdateMemberRepositoryCreationPermissionAuditEntry" | "OrgUpdateMemberRepositoryInvitationPermissionAuditEntry" | "Organization" | "OrganizationIdentityProvider" | "OrganizationInvitation" | "Package" | "PackageFile" | "PackageTag" | "PackageVersion" | "PinnedEvent" | "PinnedIssue" | "PrivateRepositoryForkingDisableAuditEntry" | "PrivateRepositoryForkingEnableAuditEntry" | "Project" | "ProjectColumn" | "PublicKey" | "PullRequest" | "PullRequestCommit" | "PullRequestCommitCommentThread" | "PullRequestReview" | "PullRequestReviewComment" | "PullRequestReviewThread" | "Push" | "PushAllowance" | "Reaction" | "ReadyForReviewEvent" | "Ref" | "ReferencedEvent" | "Release" | "ReleaseAsset" | "RemovedFromProjectEvent" | "RenamedTitleEvent" | "ReopenedEvent" | "RepoAccessAuditEntry" | "RepoAddMemberAuditEntry" | "RepoAddTopicAuditEntry" | "RepoArchivedAuditEntry" | "RepoChangeMergeSettingAuditEntry" | "RepoConfigDisableAnonymousGitAccessAuditEntry" | "RepoConfigDisableCollaboratorsOnlyAuditEntry" | "RepoConfigDisableContributorsOnlyAuditEntry" | "RepoConfigDisableSockpuppetDisallowedAuditEntry" | "RepoConfigEnableAnonymousGitAccessAuditEntry" | "RepoConfigEnableCollaboratorsOnlyAuditEntry" | "RepoConfigEnableContributorsOnlyAuditEntry" | "RepoConfigEnableSockpuppetDisallowedAuditEntry" | "RepoConfigLockAnonymousGitAccessAuditEntry" | "RepoConfigUnlockAnonymousGitAccessAuditEntry" | "RepoCreateAuditEntry" | "RepoDestroyAuditEntry" | "RepoRemoveMemberAuditEntry" | "RepoRemoveTopicAuditEntry" | "Repository" | "RepositoryInvitation" | "RepositoryTopic" | "RepositoryVisibilityChangeDisableAuditEntry" | "RepositoryVisibilityChangeEnableAuditEntry" | "RepositoryVulnerabilityAlert" | "ReviewDismissalAllowance" | "ReviewDismissedEvent" | "ReviewRequest" | "ReviewRequestRemovedEvent" | "ReviewRequestedEvent" | "SavedReply" | "SecurityAdvisory" | "SponsorsListing" | "SponsorsTier" | "Sponsorship" | "Status" | "StatusCheckRollup" | "StatusContext" | "SubscribedEvent" | "Tag" | "Team" | "TeamAddMemberAuditEntry" | "TeamAddRepositoryAuditEntry" | "TeamChangeParentTeamAuditEntry" | "TeamDiscussion" | "TeamDiscussionComment" | "TeamRemoveMemberAuditEntry" | "TeamRemoveRepositoryAuditEntry" | "Topic" | "TransferredEvent" | "Tree" | "UnassignedEvent" | "UnlabeledEvent" | "UnlockedEvent" | "UnmarkedAsDuplicateEvent" | "UnpinnedEvent" | "UnsubscribedEvent" | "User" | "UserBlockedEvent" | "UserContentEdit" | "UserStatus" | "VerifiableDomain";
}

export interface CardIdToPr_node_ProjectCard_content_Issue {
  __typename: "Issue";
}

export interface CardIdToPr_node_ProjectCard_content_PullRequest {
  __typename: "PullRequest";
  /**
   * Identifies the state of the pull request.
   */
  state: PullRequestState;
  /**
   * Identifies the pull request number.
   */
  number: number;
}

export type CardIdToPr_node_ProjectCard_content = CardIdToPr_node_ProjectCard_content_Issue | CardIdToPr_node_ProjectCard_content_PullRequest;

export interface CardIdToPr_node_ProjectCard {
  __typename: "ProjectCard";
  /**
   * The card content item
   */
  content: CardIdToPr_node_ProjectCard_content | null;
}

export type CardIdToPr_node = CardIdToPr_node_AddedToProjectEvent | CardIdToPr_node_ProjectCard;

export interface CardIdToPr {
  /**
   * Fetches an object given its ID.
   */
  node: CardIdToPr_node | null;
}

export interface CardIdToPrVariables {
  id: string;
}
