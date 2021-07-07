import moment = require("moment");

export function mapDefined<T, U>(arr: ReadonlyArray<T>, f: (t: T) => U | undefined): ReadonlyArray<U> {
    const out: U[] = [];
    for (const t of arr) {
        const u = f(t);
        if (u !== undefined) {
            out.push(u);
        }
    }
    return out;
}

export async function someAsync<T>(arr: ReadonlyArray<T>, f: (t: T) => Promise<boolean>): Promise<boolean> {
    for (const x of arr) {
        if (await f(x)) {
            return true;
        }
    }
    return false;
}

export function findLast<T, U extends T>(arr: readonly T[] | null | undefined, predicate: (item: T) => item is U): U | undefined;
export function findLast<T>(arr: readonly T[] | null | undefined, predicate: (item: T) => boolean): T | undefined;
export function findLast<T>(arr: readonly T[] | null | undefined, predicate: (item: T) => boolean) {
    if (!arr) {
        return undefined;
    }
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) {
            return arr[i];
        }
    }
    return undefined;
}

export function forEachReverse<T, U>(arr: readonly T[] | null | undefined, action: (item: T) => U | undefined): U | undefined {
    if (!arr) {
        return undefined;
    }
    for (let i = arr.length - 1; i >= 0; i--) {
        const result = action(arr[i]);
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}

export function daysSince(date: Date, now: Date | string): number {
    return Math.floor(moment(now).diff(moment(date), "days"));
}

export function authorNotBot(node: { login: string } | { author?: { login: string } | null} | { actor?: { login: string } | null}): boolean {
    return ("author" in node && node.author!.login !== "typescript-bot")
        || ("actor" in node && node.actor!.login !== "typescript-bot")
        || ("login" in node && node.login !== "typescript-bot");
}
