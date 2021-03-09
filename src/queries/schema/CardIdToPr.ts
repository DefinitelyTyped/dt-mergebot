/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

import { PullRequestState } from "./graphql-global-types";

// ====================================================
// GraphQL query operation: CardIdToPr
// ====================================================

export interface CardIdToPr_node_CodeOfConduct {
  __typename: "CodeOfConduct" | "Enterprise" | "EnterpriseUserAccount" | "Organization" | "Package" | "PackageVersion" | "PackageFile" | "Release" | "User" | "Project" | "ProjectColumn" | "Issue" | "UserContentEdit" | "Label" | "PullRequest" | "Reaction" | "Repository" | "License" | "BranchProtectionRule" | "Ref" | "PushAllowance" | "App" | "Team" | "UserStatus" | "TeamDiscussion" | "TeamDiscussionComment" | "OrganizationInvitation" | "ReviewDismissalAllowance" | "CommitComment" | "Commit" | "CheckSuite" | "CheckRun" | "Push" | "Deployment" | "DeploymentStatus" | "Status" | "StatusContext" | "StatusCheckRollup" | "Tree" | "DeployKey" | "Language" | "Milestone" | "PinnedIssue" | "RepositoryTopic" | "Topic" | "RepositoryVulnerabilityAlert" | "SecurityAdvisory" | "CWE" | "IssueComment" | "PullRequestCommit" | "PullRequestReview" | "PullRequestReviewComment" | "ReviewRequest" | "Mannequin" | "PullRequestReviewThread" | "AssignedEvent" | "Bot" | "BaseRefDeletedEvent" | "BaseRefForcePushedEvent" | "ClosedEvent" | "CommitCommentThread" | "CrossReferencedEvent" | "DemilestonedEvent" | "DeployedEvent" | "DeploymentEnvironmentChangedEvent" | "HeadRefDeletedEvent" | "HeadRefForcePushedEvent" | "HeadRefRestoredEvent" | "LabeledEvent" | "LockedEvent" | "MergedEvent" | "MilestonedEvent" | "ReferencedEvent" | "RenamedTitleEvent" | "ReopenedEvent" | "ReviewDismissedEvent" | "ReviewRequestRemovedEvent" | "ReviewRequestedEvent" | "SubscribedEvent" | "UnassignedEvent" | "UnlabeledEvent" | "UnlockedEvent" | "UnsubscribedEvent" | "UserBlockedEvent" | "AddedToProjectEvent" | "AutoMergeDisabledEvent" | "AutoMergeEnabledEvent" | "AutoRebaseEnabledEvent" | "AutoSquashEnabledEvent" | "AutomaticBaseChangeFailedEvent" | "AutomaticBaseChangeSucceededEvent" | "BaseRefChangedEvent" | "CommentDeletedEvent" | "ConnectedEvent" | "ConvertToDraftEvent" | "ConvertedNoteToIssueEvent" | "DisconnectedEvent" | "MarkedAsDuplicateEvent" | "MentionedEvent" | "MovedColumnsInProjectEvent" | "PinnedEvent" | "PullRequestCommitCommentThread" | "ReadyForReviewEvent" | "RemovedFromProjectEvent" | "TransferredEvent" | "UnmarkedAsDuplicateEvent" | "UnpinnedEvent" | "Gist" | "GistComment" | "SponsorsListing" | "SponsorsTier" | "Sponsorship" | "PublicKey" | "SavedReply" | "ReleaseAsset" | "MembersCanDeleteReposClearAuditEntry" | "MembersCanDeleteReposDisableAuditEntry" | "MembersCanDeleteReposEnableAuditEntry" | "OauthApplicationCreateAuditEntry" | "OrgAddBillingManagerAuditEntry" | "OrgAddMemberAuditEntry" | "OrgBlockUserAuditEntry" | "OrgConfigDisableCollaboratorsOnlyAuditEntry" | "OrgConfigEnableCollaboratorsOnlyAuditEntry" | "OrgCreateAuditEntry" | "OrgDisableOauthAppRestrictionsAuditEntry" | "OrgDisableSamlAuditEntry" | "OrgDisableTwoFactorRequirementAuditEntry" | "OrgEnableOauthAppRestrictionsAuditEntry" | "OrgEnableSamlAuditEntry" | "OrgEnableTwoFactorRequirementAuditEntry" | "OrgInviteMemberAuditEntry" | "OrgInviteToBusinessAuditEntry" | "OrgOauthAppAccessApprovedAuditEntry" | "OrgOauthAppAccessDeniedAuditEntry" | "OrgOauthAppAccessRequestedAuditEntry" | "OrgRemoveBillingManagerAuditEntry" | "OrgRemoveMemberAuditEntry" | "OrgRemoveOutsideCollaboratorAuditEntry" | "OrgRestoreMemberAuditEntry" | "OrgUnblockUserAuditEntry" | "OrgUpdateDefaultRepositoryPermissionAuditEntry" | "OrgUpdateMemberAuditEntry" | "OrgUpdateMemberRepositoryCreationPermissionAuditEntry" | "OrgUpdateMemberRepositoryInvitationPermissionAuditEntry" | "PrivateRepositoryForkingDisableAuditEntry" | "PrivateRepositoryForkingEnableAuditEntry" | "RepoAccessAuditEntry" | "RepoAddMemberAuditEntry" | "RepoAddTopicAuditEntry" | "RepoArchivedAuditEntry" | "RepoChangeMergeSettingAuditEntry" | "RepoConfigDisableAnonymousGitAccessAuditEntry" | "RepoConfigDisableCollaboratorsOnlyAuditEntry" | "RepoConfigDisableContributorsOnlyAuditEntry" | "RepoConfigDisableSockpuppetDisallowedAuditEntry" | "RepoConfigEnableAnonymousGitAccessAuditEntry" | "RepoConfigEnableCollaboratorsOnlyAuditEntry" | "RepoConfigEnableContributorsOnlyAuditEntry" | "RepoConfigEnableSockpuppetDisallowedAuditEntry" | "RepoConfigLockAnonymousGitAccessAuditEntry" | "RepoConfigUnlockAnonymousGitAccessAuditEntry" | "RepoCreateAuditEntry" | "RepoDestroyAuditEntry" | "RepoRemoveMemberAuditEntry" | "RepoRemoveTopicAuditEntry" | "RepositoryVisibilityChangeDisableAuditEntry" | "RepositoryVisibilityChangeEnableAuditEntry" | "TeamAddMemberAuditEntry" | "TeamAddRepositoryAuditEntry" | "TeamChangeParentTeamAuditEntry" | "TeamRemoveMemberAuditEntry" | "TeamRemoveRepositoryAuditEntry" | "VerifiableDomain" | "IpAllowListEntry" | "OrganizationIdentityProvider" | "ExternalIdentity" | "EnterpriseServerInstallation" | "EnterpriseServerUserAccount" | "EnterpriseServerUserAccountEmail" | "EnterpriseServerUserAccountsUpload" | "EnterpriseRepositoryInfo" | "EnterpriseAdministratorInvitation" | "RepositoryInvitation" | "EnterpriseIdentityProvider" | "MarketplaceCategory" | "MarketplaceListing" | "Blob" | "PackageTag" | "Tag";
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

export type CardIdToPr_node = CardIdToPr_node_CodeOfConduct | CardIdToPr_node_ProjectCard;

export interface CardIdToPr {
  /**
   * Fetches an object given its ID.
   */
  node: CardIdToPr_node | null;
}

export interface CardIdToPrVariables {
  id: string;
}
