import fetch from "node-fetch";

export async function fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    return response.text();
}
