import { PR as PRQueryResult, PR_repository_pullRequest } from "./schema/PR";
import { Actions } from "./compute-pr-actions";
import { createMutation, mutate, Mutation } from "./graphql-client";
import { getProjectBoardColumns, getLabels } from "./util/cachedQueries";

// https://github.com/DefinitelyTyped/DefinitelyTyped/projects/5
const ProjectBoardNumber = 5;

const addComment = `mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }`;
const addLabels = `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { clientMutationId } }`;
const removeLabels = `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { clientMutationId } }`;
const editComment = `mutation($input: UpdateIssueCommentInput!) { updateIssueComment(input: $input) { clientMutationId } }`;
const mergePr = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }`;
const closePr = `mutation($input: ClosePullRequestInput!) { closePullRequest(input: $input) { clientMutationId } }`;

const addProjectCard = `mutation($input: AddProjectCardInput!) { addProjectCard(input: $input) { clientMutationId } }`;
const moveProjectCard = `mutation($input: MoveProjectCardInput!) { moveProjectCard(input: $input) { clientMutationId } }`;

export async function executePrActions(actions: Actions, info: PRQueryResult, dry: true): Promise<string[]>;
export async function executePrActions(actions: Actions, info: PRQueryResult, dry?: boolean): Promise<undefined>;
export async function executePrActions(actions: Actions, info: PRQueryResult, dry?: boolean) {
  const pr = info.repository?.pullRequest!;

  let mutations: Mutation[] = [];
  const labels = info.repository?.pullRequest?.labels?.nodes!;

  const labelMutations = await getMutationsForLabels(actions, labels, pr);
  mutations = mutations.concat(labelMutations);

  const projectMutations = await getMutationsForProjectChanges(actions, pr);
  mutations = mutations.concat(projectMutations);

  const commentMutations = await getMutationsForComments(actions, pr);
  mutations = mutations.concat(commentMutations);

  const prStateMutations = await getMutationsForChangingPRState(actions, pr);
  mutations = mutations.concat(prStateMutations);

  if (dry) {
    return mutations.map((m) => m.body);
  } else {
    // Perform mutations one at a time
    const mutationResults: { mutation: Mutation; result: string }[] = [];
    for (const mutation of mutations) {
      const result = await mutate(mutation);
      mutationResults.push({ mutation, result });
    }

    console.log(
      JSON.stringify(
        mutationResults.map(({ mutation, result }) => ({
          mutation: mutation.body,
          result,
        })),
        undefined,
        2
      )
    );

    return;
  }
}

const prefix = "\n<!--typescript_bot_";
const suffix = "-->";

async function getMutationsForLabels(
  actions: Actions,
  labels: ({ name: string } | null)[],
  pr: PR_repository_pullRequest
) {
  const mutations: Mutation[] = [];
  const labelsToAdd: string[] = [];
  const labelsToRemove: string[] = [];

  if (!actions.shouldUpdateLabels) {
    return mutations;
  }

  for (const key of Object.keys(actions.labels) as (keyof typeof actions["labels"])[]) {
    const exists = labels.some((l) => l && l.name === key);
    if (exists && !actions.labels[key]) {
      labelsToRemove.push(key);
    }

    if (!exists && actions.labels[key]) {
      labelsToAdd.push(key);
    }
  }

  if (labelsToAdd.length) {
    const labelIds: string[] = [];
    for (const label of labelsToAdd) {
      labelIds.push(await getLabelIdByName(label));
    }
    mutations.push(
      createMutation(addLabels, {
        input: {
          labelIds,
          labelableId: pr.id,
        },
      })
    );
  }

  if (labelsToRemove.length) {
    const labelIds: string[] = [];
    for (const label of labelsToRemove) {
      labelIds.push(await getLabelIdByName(label));
    }

    mutations.push(
      createMutation(removeLabels, {
        input: {
          labelIds,
          labelableId: pr.id,
        },
      })
    );
  }

  return mutations;
}

async function getMutationsForProjectChanges(actions: Actions, pr: PR_repository_pullRequest) {
  const mutations: Mutation[] = [];

  if (!actions.shouldUpdateProjectColumn) {
    return mutations;
  }

  // Create a project card if needed, otherwise move if needed
  if (actions.targetColumn) {
    const extantCard = pr.projectCards.nodes?.filter((n) => !!n?.column && n.project.number === ProjectBoardNumber)[0];

    const targetColumnId = await getProjectBoardColumnIdByName(actions.targetColumn);
    if (extantCard) {
      if (extantCard.column?.name !== actions.targetColumn) {
        mutations.push(
          createMutation(moveProjectCard, {
            input: {
              cardId: extantCard.id,
              columnId: targetColumnId,
            },
          })
        );
      }
    } else {
      mutations.push(
        createMutation(addProjectCard, {
          input: { contentId: pr.id, projectColumnId: targetColumnId },
        })
      );
    }
  }
  return mutations;
}

async function getMutationsForComments(actions: Actions, pr: PR_repository_pullRequest) {
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

            mutations.push(
              createMutation(editComment, {
                input: {
                  id: actualComment.id,
                  body,
                },
              })
            );
          }
          break;
        }
      }
    }

    if (!exists) {
      mutations.push(
        createMutation(addComment, {
          input: { subjectId: pr.id, body: makeComment(wantedComment.status, wantedComment.tag) },
        })
      );
    }
  }

  return mutations;
}

async function getMutationsForChangingPRState(actions: Actions, pr: PR_repository_pullRequest) {
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
    mutations.push(
      createMutation(closePr, {
        input: {
          pullRequestId: pr.id,
        },
      })
    );
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
