import { fetchText } from "./io";

export async function getMonthlyDownloadCount(packageName: string): Promise<number> {
    const url = `https://api.npmjs.org/downloads/point/last-month/@types/${packageName}`;
    const result = JSON.parse(await fetchText(url)) as { downloads?: number };
    // For a package not on NPM, just return 0.
    return result.downloads === undefined ?  0 : result.downloads;
}
