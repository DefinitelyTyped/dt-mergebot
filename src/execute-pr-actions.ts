import { GetPRInfo } from "./pr-query";
import { PR as PRQueryResult, PR_repository_pullRequest as GraphqlPullRequest, PR_repository_pullRequest_commits_nodes_commit, PR_repository_pullRequest } from "./schema/PR";
import { Actions } from "./compute-pr-actions";
import { client, mutate } from "./graphql-client";
import { GetLabels, GetProjectColumns } from "./label-query";
import { createCache } from "./ttl-cache";
import { GetProjectColumns as GetProjectColumnsResult } from "./schema/GetProjectColumns";
import { GetLabels as GetLabelsResult } from "./schema/GetLabels";

// https://github.com/DefinitelyTyped/DefinitelyTyped/projects/5
const ProjectBoardNumber = 5;

const cache = createCache();

const addComment = `mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }`;
const addLabels = `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { clientMutationId } }`;
const removeLabels = `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { clientMutationId } }`;
const editComment = `mutation($input: UpdateIssueCommentInput!) { updateIssueComment(input: $input) { clientMutationId } }`;
const mergePr = `mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }`;
const closePr = `mutation($input: ClosePullRequestInput!) { closePullRequest(input: $input) { clientMutationId } }`;

const addProjectCard = `mutation($input: AddProjectCardInput!) { addProjectCard(input: $input) { clientMutationId } }`;
const moveProjectCard = `mutation($input: MoveProjectCardInput!) { moveProjectCard(input: $input) { clientMutationId } }`;

export async function executePrActions(actions: Actions) {
    // Get the latest version of this PR's info
    const info = await client.query<PRQueryResult>({
        query: GetPRInfo,
        variables: {
            pr_number: actions.pr_number
        },
        fetchPolicy: "network-only",
        fetchResults: true
    });
    const pr = info.data.repository?.pullRequest!;

    const waiting: Promise<unknown>[] = [];

    const labels = info.data.repository?.pullRequest?.labels?.nodes!;
    const labelsToAdd: string[] = [];
    const labelsToRemove: string[] = [];
    for (const key of Object.keys(actions.labels) as (keyof (typeof actions)["labels"])[]) {
        const exists = labels.some(l => l && l.name === key);
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
        waiting.push(mutate(addLabels, {
            input: {
                labelIds,
                labelableId: pr.id
            }
        }));
    }
    if (labelsToRemove.length) {
        const labelIds: string[] = [];
        for (const label of labelsToRemove) {
            labelIds.push(await getLabelIdByName(label));
        }

        waiting.push(mutate(removeLabels, {
            input: {
                labelIds,
                labelableId: pr.id
            }
        }));
    }

    for (const wantedComment of actions.responseComments) {
        let exists = false;
        for (const actualComment of info.data.repository?.pullRequest?.comments.nodes ?? []) {
            if (actualComment?.author?.login === "typescript-bot") {
                const parsed = parseComment(actualComment.body);
                if (parsed && parsed.tag === wantedComment.tag) {
                    exists = true;
                    if (parsed.status === wantedComment.status) {
                        // Comment is up-to-date; skip
                    } else {
                        // Edit it
                        const body = makeComment(wantedComment.status, wantedComment.tag)
                        if (body === actualComment.body) break
                        
                        waiting.push(mutate(editComment, {
                            input: {
                                id: actualComment.id,
                                body
                            }
                        }));
                    }
                    break;
                }
            }
        }

        if (!exists) {
            waiting.push(mutate(addComment, {
                input: {
                    subjectId: pr.id,
                    body: makeComment(wantedComment.status, wantedComment.tag)
                }
            }));
        }
    }

    if (actions.shouldMerge) {
        waiting.push(mutate(mergePr, {
            input: {
                commitHeadline: `🤖 Merge PR #${pr.number} ${pr.title} by @${pr.author?.login ?? "(ghost)"}`,
                expectedHeadOid: pr.headRefOid,
                mergeMethod: "SQUASH",
                pullRequestId: pr.id
            }
        }));
    }
    
    if (actions.shouldClose) {
        waiting.push(mutate(closePr, {
            input: {
                pullRequestId: pr.id
            }
        }));
    }

    // Create a project card if needed, otherwise move if needed
    if (actions.targetColumn) {
        const extantCard = pr.projectCards.nodes?.filter(n => !!n?.column && n.project.number === ProjectBoardNumber)[0];
        const targetColumnId = await getProjectBoardColumnIdByName(actions.targetColumn);
        if (extantCard) {
            if (extantCard.column?.name !== actions.targetColumn) {
                waiting.push(mutate(moveProjectCard, {
                    input: {
                        cardId: extantCard.id,
                        columnId: targetColumnId
                    }
                }));
            }
        } else {
            waiting.push(mutate(addProjectCard, {
                input: {
                    contentId: pr.id,
                    projectColumnId: targetColumnId
                }
            }));
        }
    }
    

    const results = await Promise.all(waiting);
    for (const res of results) {
        console.log(res);
    }
}

const prefix = "\n<!--typescript_bot_";
const suffix = "-->";

function parseComment(body: string): undefined | { status: string, tag: string } {
    if (body.endsWith(suffix)) {
        const start = body.lastIndexOf(prefix);
        const end = body.lastIndexOf(suffix);
        return {
            status: body.substr(0, start),
            tag: body.substr(start + prefix.length, end - start - prefix.length)
        };
    }
    return undefined;
}

function makeComment(body: string, tag: string) {
    return `${body}${prefix}${tag}${suffix}`;
}

async function getProjectBoardColumnIdByName(name: string): Promise<string> {
    const data = await cache.getAsync("project board colum names", Infinity, async () => {
        const res = await query<GetProjectColumnsResult>(GetProjectColumns);
        return res.repository?.project?.columns.nodes ?? [];
    });
    const res = data.filter(e => e && e.name === name)[0]?.id;
    if (res !== undefined) {
        return res;
    }
    throw new Error(`No project board column named "${name}" exists`);
}

async function getLabelIdByName(name: string): Promise<string> {
    const data = await cache.getAsync("label ids", Infinity, async () => {
        const res = await query<GetLabelsResult>(GetLabels);
        return res.repository?.labels?.nodes?.filter(defined) ?? [];
    });
    const res = data.filter(e => e.name === name)[0]?.id;
    if (res !== undefined) {
        return res;
    }
    throw new Error(`No label named "${name}" exists`);
}

function defined<T>(arg: T | null | undefined): arg is T {
    return arg != null;
}

async function query<T>(gql: any): Promise<T> {
    const res = await client.query<T>({
        query: gql,
        fetchPolicy: "network-only",
        fetchResults: true
    });
    return res.data;
}
