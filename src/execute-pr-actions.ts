import { PR as PRQueryResult, PR_repository_pullRequest } from "./queries/schema/PR";
import { Actions } from "./compute-pr-actions";
import { createMutation, mutate, Mutation } from "./graphql-client";
import { getProjectBoardColumns, getLabels } from "./util/cachedQueries";

// https://github.com/DefinitelyTyped/DefinitelyTyped/projects/5
const ProjectBoardNumber = 5;

const addComment = `mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }`;
const deleteComment = `mutation($input: DeleteIssueCommentInput!) { deleteIssueComment(input: $input) { clientMutationId } }`;
const editComment = `mutation($input: UpdateIssueCommentInput!) { updateIssueComment(input: $input) { clientMutationId } }`;
const addLabels = `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { clientMutationId } }`;
const removeLabels = `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { clientMutationId } }`;
const mergePr = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }`;
const closePr = `mutation($input: ClosePullRequestInput!) { closePullRequest(input: $input) { clientMutationId } }`;

const addProjectCard = `mutation($input: AddProjectCardInput!) { addProjectCard(input: $input) { clientMutationId } }`;
const moveProjectCard = `mutation($input: MoveProjectCardInput!) { moveProjectCard(input: $input) { clientMutationId } }`;
export const deleteProjectCard = `mutation($input: DeleteProjectCardInput!) { deleteProjectCard(input: $input) { clientMutationId } }`;

export async function executePrActions(actions: Actions, info: PRQueryResult, dry?: boolean) {
  const pr = info.repository?.pullRequest!;

  let mutations: Mutation[] = [];

  const labelMutations = await getMutationsForLabels(actions, pr);
  mutations = mutations.concat(labelMutations);

  const projectMutations = await getMutationsForProjectChanges(actions, pr);
  mutations = mutations.concat(projectMutations);

  const commentMutations = getMutationsForComments(actions, pr);
  mutations = mutations.concat(commentMutations);

  const commentRemovalMutations = getMutationsForCommentRemovals(actions, pr);
  mutations = mutations.concat(commentRemovalMutations);

  const prStateMutations = getMutationsForChangingPRState(actions, pr);
  mutations = mutations.concat(prStateMutations);

  if (!dry) {
    // Perform mutations one at a time
    for (const mutation of mutations) {
      await mutate(mutation);
    }
  }

  return mutations.map((m) => m.body);
}

const prefix = "\n<!--typescript_bot_";
const suffix = "-->";

async function getMutationsForLabels(actions: Actions, pr: PR_repository_pullRequest) {
const labels = pr.labels?.nodes!;
  const mutations: Mutation[] = [];
  const labelsToAdd: string[] = [];
  const labelsToRemove: string[] = [];

  if (!actions.shouldUpdateLabels) {
    return mutations;
  }

  for (const key of Object.keys(actions.labels) as (keyof typeof actions["labels"])[]) {
    const exists = labels.some((l) => l && l.name === key);
    if (exists && !actions.labels[key]) labelsToRemove.push(key);
    if (!exists && actions.labels[key]) labelsToAdd.push(key);
  }

  if (labelsToAdd.length) {
    const labelIds: string[] = [];
    for (const label of labelsToAdd) {
      labelIds.push(await getLabelIdByName(label));
    }

    mutations.push( createMutation(addLabels, { input: { labelIds, labelableId: pr.id, } }));
  }

  if (labelsToRemove.length) {
    const labelIds: string[] = [];
    for (const label of labelsToRemove) {
      labelIds.push(await getLabelIdByName(label));
    }

    mutations.push( createMutation(removeLabels, { input: { labelIds, labelableId: pr.id } }) );
  }

  return mutations;
}

async function getMutationsForProjectChanges(actions: Actions, pr: PR_repository_pullRequest) {
  const mutations: Mutation[] = [];

  if (actions.shouldRemoveFromActiveColumns) {
    const card = pr.projectCards.nodes?.find(card => card?.project.number === ProjectBoardNumber);
    if (card && card.column?.name !== "Recently Merged") {
      mutations.push(createMutation(deleteProjectCard, { input: { cardId: card.id } }));
    }
    return mutations;
  }

  if (!actions.shouldUpdateProjectColumn) {
    return mutations;
  }

  // Create a project card if needed, otherwise move if needed
  if (actions.targetColumn) {
    const extantCard = pr.projectCards.nodes?.find((n) => !!n?.column && n.project.number === ProjectBoardNumber);

    const targetColumnId = await getProjectBoardColumnIdByName(actions.targetColumn);
    if (extantCard) {
      if (extantCard.column?.name !== actions.targetColumn) {
        mutations.push( createMutation(moveProjectCard, { input: { cardId: extantCard.id, columnId: targetColumnId } }) );
      }

    } else {
      mutations.push( createMutation(addProjectCard, { input: { contentId: pr.id, projectColumnId: targetColumnId } }) );
    }
  }
  return mutations;
}

function getMutationsForComments(actions: Actions, pr: PR_repository_pullRequest) {
  const mutations: Mutation[] = [];
  for (const wantedComment of actions.responseComments) {
    let exists = false;
    for (const actualComment of pr.comments.nodes ?? []) {
      if (actualComment?.author?.login === "typescript-bot") {
        const parsed = parseComment(actualComment.body);
        if (parsed && parsed.tag === wantedComment.tag) {
          exists = true;
          if (parsed.status === wantedComment.status) {
            // Comment is up-to-date; skip
          } else {
            // Edit it
            const body = makeComment(wantedComment.status, wantedComment.tag);
            if (body === actualComment.body) break;

            mutations.push( createMutation(editComment, { input: { id: actualComment.id, body, } }) );
          }
          break;
        }
      }
    }

    if (!exists) {
      mutations.push( createMutation(addComment, {
          input: { subjectId: pr.id, body: makeComment(wantedComment.status, wantedComment.tag) },
        })
      );
    }
  }

  return mutations;
}


function getMutationsForCommentRemovals(actions: Actions, pr: PR_repository_pullRequest) {
  const mutations: Mutation[] = [];

  const travisMessageToKeep = actions.responseComments.find(c => c.tag.startsWith("travis-complaint"))
  const botComments = (pr.comments.nodes ?? []).filter(comment => comment?.author?.login === "typescript-bot")
  for (const comment of botComments) {
    if (!comment) continue

    const parsed = parseComment(comment.body);    
    if (!parsed) continue

    // Remove stale travis 'your build is green' notifications
    if (parsed.tag.includes("travis") && parsed.tag !== travisMessageToKeep?.tag) {
      mutations.push( createMutation(deleteComment, { input: { id: comment.id } }) )
    }

    // It used to be mergable, but now it is not, remove those comments
    if (parsed.tag === "merge-offer" && !actions.isReadyForAutoMerge) {
      mutations.push( createMutation(deleteComment, { input: { id: comment.id } }) )
    } 
  }



  return mutations;
}

function getMutationsForChangingPRState(actions: Actions, pr: PR_repository_pullRequest) {
  const mutations: Mutation[] = [];

  if (actions.shouldMerge) {
    mutations.push(
      createMutation(mergePr, {
        input: {
          commitHeadline: `🤖 Merge PR #${pr.number} ${pr.title} by @${pr.author?.login ?? "(ghost)"}`,
          expectedHeadOid: pr.headRefOid,
          mergeMethod: "SQUASH",
          pullRequestId: pr.id,
        },
      })
    );
  }

  if (actions.shouldClose) {
    mutations.push( createMutation(closePr, { input: { pullRequestId: pr.id } }) );
  }
  return mutations;
}

function parseComment(body: string): undefined | { status: string; tag: string } {
  if (body.endsWith(suffix)) {
    const start = body.lastIndexOf(prefix);
    const end = body.lastIndexOf(suffix);
    return {
      status: body.substr(0, start),
      tag: body.substr(start + prefix.length, end - start - prefix.length),
    };
  }
  return undefined;
}

function makeComment(body: string, tag: string) {
  return `${body}${prefix}${tag}${suffix}`;
}

async function getProjectBoardColumnIdByName(name: string): Promise<string> {
  const columns = await getProjectBoardColumns();
  const res = columns.filter((e) => e && e.name === name)[0]?.id;
  if (res !== undefined) {
    return res;
  }
  throw new Error(`No project board column named "${name}" exists`);
}

export async function getLabelIdByName(name: string): Promise<string> {
  const labels = await getLabels();
  const res = labels.find((l) => l.name === name)?.id;
  if (res !== undefined) {
    return res;
  }
  throw new Error(`No label named "${name}" exists`);
}
