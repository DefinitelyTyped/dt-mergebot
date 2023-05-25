/*
 * @jest-environment ./src/_tests/testEnvironment
 */
/// <reference types="jest" />
import {canHandleRequest, extractNPMReference} from "../discussions";

// polyfill TextEncoder/TextDecoder for jest
Object.assign(global, { TextEncoder, TextDecoder });
describe(canHandleRequest, () => {
Object.assign(global, { TextEncoder, TextDecoder });
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

describe(extractNPMReference, () => {
Object.assign(global, { TextEncoder, TextDecoder });
    const eventActions = [
        ["[node] my thingy", "node"],
        ["OK [react]", "react"],
        ["I  think [@typescript/twoslash] need improving ", "@typescript/twoslash"],
        ["[@types/node] needs X", "node"],
    ] as const;

    test.concurrent.each(eventActions)("(%s, %s) is %s", async (title, result) => {
        expect(extractNPMReference({ title })).toEqual(result);
    });
});
