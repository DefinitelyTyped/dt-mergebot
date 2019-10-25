import * as bot from "idembot";

import { commentApprovalTokens, commentDisapprovalTokens } from "./comments";

export const enum Opinion { Unknown, Approve, Reject }

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
}

export async function getCodeReviews(pr: bot.PullRequest): Promise<ReviewsInfo> {
    let reviews: Review[] = [];
    const prUser = pr.user.login;
    await getCommentReviews(await pr.getComments(), prUser, reviews);
    getProperReviews(await pr.getReviews(), prUser, reviews);

    // Sort by date, oldest first
    reviews.sort((a, b) => +a.date - +b.date);
    // Get only the most recent review by each reviewer.
    reviews = reviews.filter((r, i) =>
        // Latest if no other review by the same login has a higher index.
        !reviews.some((r2, i2) => r.reviewer === r2.reviewer && i2 > i));

    return { reviews };
}

interface Push<T> {
    push(value: T): void;
}

async function getCommentReviews(
    comments: ReadonlyArray<bot.IssueComment>,
    prUser: string,
    reviews: Push<Review>
    ): Promise<void> {
    // Parse comments
    for (const comment of comments) {
        const commenter = comment.user.login;
        // No self-reviews
        if (commenter === prUser)
            continue;

        if (commentApprovalTokens.some(at => comment.body.includes(at)) && commentDisapprovalTokens.every(dt => !comment.body.includes(dt))) {
            // Approval via comment
            reviews.push({
                date: comment.created_at.toDate(),
                reviewer: commenter,
                verdict: Opinion.Approve,
            });
        }
    }
}

function getProperReviews(
    reviewsFromApi: ReadonlyArray<bot.PullRequestReview>,
    prUser: string,
    reviews: Push<Review>): void {
    for (const r of reviewsFromApi) {
        const reviewer = r.user.login;
        // No self-reviews
        if (reviewer === prUser)
            continue;

        const verdict = commentToOpinion(r.state);
        if (verdict !== undefined) {
            reviews.push({ date: new Date(r.submitted_at), reviewer, verdict });
        }
    }
}

function commentToOpinion(state: bot.PullRequestReview["state"]): Opinion | undefined {
    switch (state) {
        case "APPROVED":
            // Approved via code review
            return Opinion.Approve;
        case "CHANGES_REQUESTED":
            return Opinion.Reject;
        case "COMMENTED":
            return undefined;
        default:
            throw new Error(`Unexpected review state: ${state}`);
    }
}
