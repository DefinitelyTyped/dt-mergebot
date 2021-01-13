export function createCache() {
    const store: any = Object.create(null);
    const lifetimes: any = Object.create(null);

    function get<T>(key: string, timeoutMs: number, produce: () => T): T {
        if (key in store) {
            if (lifetimes[key] > Date.now()) {
                return store[key];
            }
        }
        const value = produce();
        lifetimes[key] = timeoutMs + Date.now();
        store[key] = value;
        return value;
    }

    async function getAsync<T>(key: string, timeoutMs: number, produce: () => Promise<T>): Promise<T> {
        if (key in store) {
            if (lifetimes[key] > Date.now()) {
                return store[key];
            }
        }
        const value = await produce();
        lifetimes[key] = timeoutMs + Date.now();
        store[key] = value;
        return value;
    }

    return {
        get,
        getAsync
    };
}
