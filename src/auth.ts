export function getAuthToken() {
    if (process.env.JEST_WORKER_ID) return "FAKE_TOKEN";

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"] || process.env["DT_BOT_AUTH_TOKEN"];
    if (typeof result !== "string") {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }
    return result.trim();
}
