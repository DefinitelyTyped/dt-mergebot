import { fetchText } from "./io";
import { getMonthlyDownloadCount } from "./npm";
import { someAsync } from "./util";

export interface PackageInfo {
    readonly authorIsOwner: boolean;
    readonly owners: ReadonlySet<string>;
    readonly ownersAsLower: ReadonlySet<string>;
    // Manual review is required for changes to popular packages like `types/node`,
    // or changes to files outside of packages (such as `/.github/CODEOWNERS`).
    readonly touchesNonPackage: boolean;
    readonly touchesPopularPackage: boolean;
    readonly touchesMultiplePackages: boolean;
}

let codeOwners: [string, string[]][] = [];
async function fetchCodeOwnersIfNeeded() {
    if (codeOwners.length > 0) return;

    // https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/.github/CODEOWNERS
    const raw = await fetchText("https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/.github/CODEOWNERS");
    for (const line of raw.split(/\r?\n/g)) {
        if (line.trim().length === 0) continue;
        const match = /^(\S+)\s+(.*)$/.exec(line);
        if (!match) throw new Error(`Expected the line from CODEOWNERS to match the regexp - ${line}`);

        codeOwners.push([match[1], match[2].split(" ").map(removeLeadingAt)]);
    }

    function removeLeadingAt(s: string) {
        if (s[0] === '@') return s.substr(1);
        return s;
    }
}

export async function getPackagesInfo(
    author: string,
    changedFiles: ReadonlyArray<string>,
    maxMonthlyDownloads: number): Promise<PackageInfo> {

    const { packageNames, touchesNonPackage } = getChangedPackages(changedFiles);
    const owners = new Set<string>();
    const ownersAsLower = new Set<string>();
    let authorIsOwner: boolean | undefined = undefined;

    await fetchCodeOwnersIfNeeded();
    for (const codeOwnerLine of codeOwners) {
        for (const fileName of changedFiles) {
            // Reported filename doesn't start with / but the CODEOWNERS filename does
            if (('/' + fileName).startsWith(codeOwnerLine[0])) {
                const isOwner = isInOwnerList(author, codeOwnerLine[1]);
                if (isOwner) {
                    authorIsOwner = (authorIsOwner === undefined) ? true : authorIsOwner;
                } else {
                    authorIsOwner = false;
                }
                
                for (const owner of codeOwnerLine[1]) {
                    if (owner.toLowerCase() !== author.toLowerCase()) {
                        owners.add(owner);
                        ownersAsLower.add(owner.toLowerCase());
                    }
                }
            }
        }
    }

    authorIsOwner = (authorIsOwner === undefined) ? false : authorIsOwner;
    const touchesPopularPackage = await someAsync(packageNames, async packageName =>
        await getMonthlyDownloadCount(packageName) > maxMonthlyDownloads);
    const touchesMultiplePackages = packageNames.length > 2;
    return { owners, ownersAsLower, authorIsOwner, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages };
}

function isInOwnerList(user: string, ownerList: string[]): boolean {
    user = user.toLowerCase();
    for (const owner of ownerList) {
        if (owner.toLowerCase() === user) return true;
    }
    return false;
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
