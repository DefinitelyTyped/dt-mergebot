import { PR as PRQueryResult, PR_repository_pullRequest } from "./queries/schema/PR";
import { Actions, LabelNames, LabelName } from "./compute-pr-actions";
import { createMutation, mutate } from "./graphql-client";
import { getProjectBoardColumns, getLabels } from "./util/cachedQueries";
import { noNulls, flatten } from "./util/util";
import * as comment from "./util/comment";

// https://github.com/DefinitelyTyped/DefinitelyTyped/projects/5
const ProjectBoardNumber = 5;

const addComment = `mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }`;
const deleteComment = `mutation($input: DeleteIssueCommentInput!) { deleteIssueComment(input: $input) { clientMutationId } }`;
const editComment = `mutation($input: UpdateIssueCommentInput!) { updateIssueComment(input: $input) { clientMutationId } }`;
const addLabels = `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { clientMutationId } }`;
const removeLabels = `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { clientMutationId } }`;
export const mergePr = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }`;
const closePr = `mutation($input: ClosePullRequestInput!) { closePullRequest(input: $input) { clientMutationId } }`;
const addProjectCard = `mutation($input: AddProjectCardInput!) { addProjectCard(input: $input) { clientMutationId } }`;
const moveProjectCard = `mutation($input: MoveProjectCardInput!) { moveProjectCard(input: $input) { clientMutationId } }`;
export const deleteProjectCard = `mutation($input: DeleteProjectCardInput!) { deleteProjectCard(input: $input) { clientMutationId } }`;

export async function executePrActions(actions: Actions, info: PRQueryResult, dry?: boolean) {
    const pr = info.repository?.pullRequest!;
    const botComments: ParsedComment[] = getBotComments(pr);
    const mutations = noNulls([
        ...await getMutationsForLabels(actions, pr),
        ...await getMutationsForProjectChanges(actions, pr),
        ...getMutationsForComments(actions, pr.id, botComments),
        ...getMutationsForCommentRemovals(actions, botComments),
        ...getMutationsForChangingPRState(actions, pr),
    ]);
    if (!dry) {
        // Perform mutations one at a time
        for (const mutation of mutations) await mutate(mutation);
    }
    return mutations.map(m => m.body);
}

async function getMutationsForLabels(actions: Actions, pr: PR_repository_pullRequest) {
    if (!actions.shouldUpdateLabels) return []
    const labels = noNulls(pr.labels?.nodes!).map(l => l.name);
    const makeMutations = async (pred: (l: LabelName) => boolean, query: string) => {
        const labels = LabelNames.filter(pred);
        return labels.length === 0 ? null
            : createMutation(query, { input: {
                labelIds: await Promise.all(labels.map(label => getLabelIdByName(label))),
                labelableId: pr.id, } });
    };
    return Promise.all([
        makeMutations((label => !labels.includes(label) && actions.labels.includes(label)), addLabels),
        makeMutations((label => labels.includes(label) && !actions.labels.includes(label)), removeLabels),
    ]);
}

async function getMutationsForProjectChanges(actions: Actions, pr: PR_repository_pullRequest) {
    if (actions.shouldRemoveFromActiveColumns) {
        const card = pr.projectCards.nodes?.find(card => card?.project.number === ProjectBoardNumber);
        if (card?.column?.name === "Recently Merged") return [];
        return [createMutation(deleteProjectCard, { input: { cardId: card!.id } })];
    }
    if (!(actions.shouldUpdateProjectColumn && actions.targetColumn)) return [];
    const existingCard = pr.projectCards.nodes?.find(n => !!n?.column && n.project.number === ProjectBoardNumber);
    const targetColumnId = await getProjectBoardColumnIdByName(actions.targetColumn);
    // No existing card => create a new one
    if (!existingCard) return [createMutation(addProjectCard, { input: { contentId: pr.id, projectColumnId: targetColumnId } })];
    // Existing card is ok => do nothing
    if (existingCard.column?.name === actions.targetColumn) return [];
    // Move existing card
    return [createMutation(moveProjectCard, { input: { cardId: existingCard.id, columnId: targetColumnId } })];
}

type ParsedComment = { id: string, body: string, tag: string, status: string };

function getBotComments(pr: PR_repository_pullRequest): ParsedComment[] {
    return noNulls((pr.comments.nodes ?? [])
                   .filter(comment => comment?.author?.login === "typescript-bot")
                   .map(c => {
                       const { id, body } = c!, parsed = comment.parse(body);
                       return parsed && { id, body, ...parsed };
                   }));
}

function getMutationsForComments(actions: Actions, prId: string, botComments: ParsedComment[]) {
    return flatten(actions.responseComments.map(wantedComment => {
        const sameTagComments = botComments.filter(comment => comment.tag === wantedComment.tag);
        return sameTagComments.length === 0
            ? [createMutation(addComment, {
                input: { subjectId: prId, body: comment.make(wantedComment) } })]
            : sameTagComments.map(actualComment =>
                (actualComment.status === wantedComment.status) ? null // Comment is up-to-date; skip
                : createMutation(editComment, { input: {
                    id: actualComment.id,
                    body: comment.make(wantedComment) } }));
    }));
}

function getMutationsForCommentRemovals(actions: Actions, botComments: ParsedComment[]) {
    const ciTagToKeep = actions.responseComments.find(c => c.tag.startsWith("ci-complaint"))?.tag;
    return botComments.map(comment => {
        const del = () => createMutation(deleteComment, { input: { id: comment.id } });
        // Remove stale CI 'your build is green' notifications
        if (comment.tag.includes("ci-") && comment.tag !== ciTagToKeep) return del();
        // It used to be mergable, but now it is not, remove those comments
        if (comment.tag === "merge-offer" && !actions.isReadyForAutoMerge) return del();
        return null;
    });
}

function getMutationsForChangingPRState(actions: Actions, pr: PR_repository_pullRequest) {
    return [
        actions.shouldMerge
            ? createMutation(mergePr, {
                input: {
                    commitHeadline: `🤖 Merge PR #${pr.number} ${pr.title} by @${pr.author?.login ?? "(ghost)"}`,
                    expectedHeadOid: pr.headRefOid,
                    mergeMethod: "SQUASH",
                    pullRequestId: pr.id,
                },
            })
            : null,
        actions.shouldClose
            ? createMutation(closePr, { input: { pullRequestId: pr.id } })
            : null
    ];
}

async function getProjectBoardColumnIdByName(name: string): Promise<string> {
    const columns = await getProjectBoardColumns();
    const res = columns.filter((e) => e && e.name === name)[0]?.id;
    if (!res) throw new Error(`No project board column named "${name}" exists`);
    return res;
}

export async function getLabelIdByName(name: string): Promise<string> {
    const labels = await getLabels();
    const res = labels.find(l => l.name === name)?.id;
    if (!res) throw new Error(`No label named "${name}" exists`);
    return res;
}
