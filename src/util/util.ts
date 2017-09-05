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
