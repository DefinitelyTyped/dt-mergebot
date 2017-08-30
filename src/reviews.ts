import * as bot from "idembot";

import { commentApprovalTokens, mergeplzMarker } from "./pr-info";

export const enum Opinion { Comment, Approve, Reject }

export interface Review {
    // The login of the person who performed the review
    readonly reviewer: string;
    // When it occurred
    readonly date: Date;
    // The kind of CR result
    readonly verdict: Opinion;
}

export interface CodeReviews {
    readonly reviews: ReadonlyArray<Review>;
    readonly owners: ReadonlySet<string>;
}

interface ReviewsInfo {
    readonly reviews: ReadonlyArray<Review>;
    readonly mergeRequesters: ReadonlyArray<string>;
}
export async function getCodeReviews(pr: bot.PullRequest): Promise<ReviewsInfo> {
    let reviews: Review[] = [];
    const mergeRequesters: string[] = [];
    const prUser = pr.user.login;
    await getCommentReviews(await pr.getComments(), prUser, reviews, mergeRequesters);
    getProperReviews(await pr.getReviews(), prUser, reviews, mergeRequesters);

    // Sort by date, oldest first
    reviews.sort((a, b) => +a.date - +b.date);
    // Get only the most recent review by each reviewer.
    reviews = reviews.filter((r, i) =>
        // Latest if no other review by the same login has a higher index.
        !reviews.some((r2, i2) => r.reviewer === r2.reviewer && i2 > i));

    return { reviews, mergeRequesters };
}

interface Push<T> {
    push(value: T): void;
}

async function getCommentReviews(
    comments: ReadonlyArray<bot.IssueComment>,
    prUser: string,
    reviews: Push<Review>,
    mergeRequesters: Push<string>,
    ): Promise<void> {
    // Parse comments
    for (const comment of comments) {
        const commenter = comment.user.login;
        // No self-reviews
        if (commenter === prUser)
            continue;

        if (commenter === "dt-bot") {
            // TODO: delete once dt-bot is gone
            const reactions = await comment.getReactions();
            for (const reaction of reactions) {
                const reviewer = reaction.user.login;
                if (reviewer === prUser)
                    continue;

                const verdict = getReactionVerdict(reaction.content);
                if (verdict !== undefined)
                    reviews.push({ date: new Date(reaction.created_at), reviewer, verdict });
            }
        } else if (commentApprovalTokens.some(at => comment.body.includes(at))) {
            // Approval via comment
            reviews.push({
                date: comment.created_at.toDate(),
                reviewer: commenter,
                verdict: Opinion.Approve,
            });

            if (comment.body.includes(mergeplzMarker))
                mergeRequesters.push(commenter);
        }
    }
}

function getReactionVerdict(reaction: string): Opinion | undefined {
    switch (reaction) {
        case "+1":
            return Opinion.Approve;
        case "-1":
            return Opinion.Reject;
        default:
            return undefined;
    }
}

function getProperReviews(
    reviewsFromApi: ReadonlyArray<bot.PullRequestReview>,
    prUser: string,
    reviews: Push<Review>,
    mergeRequesters: Push<string>): void {
    for (const r of reviewsFromApi) {
        const reviewer = r.user.login;
        // No self-reviews
        if (reviewer === prUser)
            continue;

        const verdict = commentToOpinion(r.state);
        reviews.push({ date: new Date(r.submitted_at), reviewer, verdict });

        if (verdict === Opinion.Approve && r.body.includes(mergeplzMarker)) {
            mergeRequesters.push(reviewer);
        }
    }
}

function commentToOpinion(state: bot.PullRequestReview["state"]): Opinion {
    switch (state) {
        case "APPROVED":
            // Approved via code review
            return Opinion.Approve;
        case "CHANGES_REQUESTED":
            return Opinion.Reject;
        case "COMMENTED":
            return Opinion.Comment;
        default:
            throw new Error(`Unexpected review state: ${state}`);
    }
}
