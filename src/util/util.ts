import * as crypto from "crypto";

export function noNullish<T>(arr: ReadonlyArray<T | null | undefined> | null | undefined): T[] {
    if (arr == null) return [];
    return arr.filter(arr => arr != null) as T[];
}

export function flatten<T extends any[]>(xs: T[]) {
    return ([] as unknown as T).concat(...xs) as T;
}

export function unique<T>(xs: T[]) {
    return [...new Set(xs)];
}

export async function someAsync<T>(arr: ReadonlyArray<T>, f: (t: T) => Promise<boolean>): Promise<boolean> {
    for (const x of arr) {
        if (await f(x)) {
            return true;
        }
    }
    return false;
}

export function findLast<T, U extends T>(arr: readonly T[] | null | undefined, predicate: (item?: T) => item is U): U | undefined;
export function findLast<T>(arr: readonly T[] | null | undefined, predicate: (item?: T) => boolean): T | undefined;
export function findLast<T>(arr: readonly T[] | null | undefined, predicate: (item?: T) => boolean) {
    if (!arr) return undefined;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return arr[i];
    }
    return undefined;
}

export function min<T>(arr: readonly [T, ...(T | undefined)[]]): T;
export function min<T>(arr: readonly T[], compare?: (a: T, b: T) => number): T | undefined;
export function min<T>(arr: readonly T[], compare?: (a: T, b: T) => number) {
    return arr.length === 0 ? undefined : arr.reduce((res, x) =>
        (compare ? compare(x, res) < 0 : x < res) ? x : res);
}

export function max<T>(arr: readonly [T, ...(T | undefined)[]]): T;
export function max<T>(arr: readonly T[], compare?: (a: T, b: T) => number): T | undefined;
export function max<T>(arr: readonly T[], compare?: (a: T, b: T) => number) {
    return arr.length === 0 ? undefined : arr.reduce((res, x) =>
        (compare ? compare(x, res) > 0 : x > res) ? x : res);
}

export function sameUser(u1: string, u2: string) {
    return u1.toLowerCase() === u2.toLowerCase();
}

export function authorNotBot(node: { login: string } | { author?: { login: string } | null} | { actor?: { login: string } | null}): boolean {
    return ("author" in node && node.author!.login !== "typescript-bot")
        || ("actor" in node && node.actor!.login !== "typescript-bot")
        || ("login" in node && node.login !== "typescript-bot");
}

export function scrubDiagnosticDetails(s: string) {
    return s.replace(/<details><summary>Diagnostic Information.*?<\/summary>(?:\\n)+```json\\n{.*?\\n}\\n```(?:\\n)+<\/details>/sg, "... diagnostics scrubbed ...");
}

export function sha256(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

export function abbrOid(s: string) {
    return s.slice(0, 7);
}
