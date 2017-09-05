import { RepoReference } from "idembot";

import { Header, parseHeaderOrFail } from "definitelytyped-header-parser";

import { fetchText } from "./io";
import { getMonthlyDownloadCount } from "./npm";
import { mapDefined, someAsync } from "./util";

export interface PackageInfo {
    readonly owners: ReadonlySet<string>;
    // Manual review is required for changes to popular packages like `types/node`,
    // or changes to files outside of packages (such as `/.github/CODEOWNERS`).
    readonly touchesNonPackage: boolean;
    readonly touchesPopularPackage: boolean;
    readonly touchesMultiplePackages: boolean;
}

export async function getPackagesInfo(
    repository: RepoReference,
    changedFiles: ReadonlyArray<string>,
    maxMonthlyDownloads: number): Promise<PackageInfo> {
    const { packageNames, touchesNonPackage } = getChangedPackages(changedFiles);
    const owners = new Set<string>();
    for (const packageName of packageNames) {
        for (const owner of await getPackageOwners(repository, packageName)) {
            owners.add(owner);
        }
    }
    const touchesPopularPackage = await someAsync(packageNames, async packageName =>
        await getMonthlyDownloadCount(packageName) > maxMonthlyDownloads);
    const touchesMultiplePackages = packageNames.length > 2;
    return { owners, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages };
}

async function getPackageOwners({ owner, name }: RepoReference, packageName: string): Promise<ReadonlyArray<string>> {
    // Query DefinitelyTyped master for the owners
    const url = `https://raw.githubusercontent.com/${owner}/${name}/master/types/${packageName}/index.d.ts`;
    const text = await fetchText(url);
    let header: Header;
    try {
        header = parseHeaderOrFail(text);
    } catch {
        return [];
    }
    return mapDefined(header.contributors, c => c.githubUsername);
}

interface ChangedPackages {
    readonly packageNames: ReadonlyArray<string>;
    readonly touchesNonPackage: boolean;
}
function getChangedPackages(changedFiles: ReadonlyArray<string>): ChangedPackages {
    let touchesNonPackage = false;
    const packageNames: string[] = [];
    for (const file of changedFiles) {
        const s = withoutStart(file, "types/");
        if (s === undefined) {
            touchesNonPackage = true;
            continue;
        }

        const slash = s.indexOf("/");
        if (slash === -1) {
            // Be suspicious of anything adding a file to `types/` -- should be mostly directories
            touchesNonPackage = true;
            continue;
        }

        packageNames.push(s.slice(0, slash));
    }
    return { packageNames, touchesNonPackage };
}

function withoutStart(s: string, start: string): string | undefined {
    return s.startsWith(start) ? s.slice(start.length) : undefined;
}
