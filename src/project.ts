import * as bot from "idembot";

export class Project {
    private projectCache: bot.Project | undefined;
    private columnsCache = new Map<string, bot.ProjectColumn>();

    async setColumn(pr: bot.PullRequest, column: ProjectColumn | undefined): Promise<void> {
        const project = await this.getProject();
        project.setIssueColumn(pr, column === undefined ? undefined : this.getColumn(project, column));
    }

    private async getProject(): Promise<bot.Project> {
        let project = this.projectCache;
        if (project === undefined) {
            project = await bot.Project.create(762086); // TODO: magic number
            this.projectCache = project;
        }
        return project;
    }

    private getColumn(project: bot.Project, columnName: ProjectColumn): bot.ProjectColumn {
        let column = this.columnsCache.get(columnName);
        if (column === undefined) {
            column = project.findColumnByName(columnName);
            if (column === undefined) throw new Error(`Cannot find project column named ${columnName}`);
            this.columnsCache.set(columnName, column);
        }
        return column;
    }
}
// Keep this in sync with https://github.com/DefinitelyTyped/DefinitelyTyped/projects/3
export const enum ProjectColumn {
    NewDefinitions = "New Definitions",
    Unowned = "Unowned",
    MergeExpress = "Merge: Express",
    MergeLGTM = "Merge: LGTM",
    MergeYSYL = "Merge: YSYL",
}
