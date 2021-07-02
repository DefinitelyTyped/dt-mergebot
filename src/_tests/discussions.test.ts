/// <reference types="jest" />
import {canHandleRequest} from "../discussions-trigger";

describe(canHandleRequest, () => {
    const eventActions = [
        ["discussion", "created", true],
        ["discussion", "edited", true],
        ["discussion", "updated", false],
        ["pull_request", "created", false]
    ] as const;

    test.concurrent.each(eventActions)("(%s, %s) is %s", async (event, action, expected) => {
        expect(canHandleRequest(event, action)).toEqual(expected);
    });
});
