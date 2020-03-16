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
