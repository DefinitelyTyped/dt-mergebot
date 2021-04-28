#!/usr/bin/env node

import * as schema from "@octokit/graphql-schema/schema";
import * as yargs from "yargs";
import { process as computeActions } from "./compute-pr-actions";
import { getAllOpenPRs } from "./queries/all-open-prs-query";
import { queryPRInfo, deriveStateForPR } from "./pr-info";
import { executePrActions } from "./execute-pr-actions";
import { getProjectBoardCards } from "./queries/projectboard-cards";
import { runQueryToGetPRForCardId } from "./queries/card-id-to-pr-query";
import { createMutation, client } from "./graphql-client";
import { flatten } from "./util/util";
import { render } from "prettyjson";
import { inspect } from "util";

const args = yargs(process.argv.slice(2))
    .usage("Usage: $0 [options] pr...")
    .usage("  Run over specified PRs, or all if no PRs specified")
    .usage("  Each pr is either a number or a N-M number range")
    .options({
        "dry": { alias: ["d"], type: "boolean", default: false, desc: "don't execute actions" },
        "cleanup": { alias: ["c"], type: "boolean", default: true, desc: "cleanup columns when done" },
        "format": { alias: ["f"], choices: ["json", "yaml", "node"], desc: "format for information display" },
        "show-raw": { alias: ["s1"], type: "boolean", desc: "display raw query result" },
        "show-basic": { alias: ["s2"], type: "boolean", desc: "display basic pr info" },
        "show-extended": { alias: ["s3"], type: "boolean", desc: "display extended info" },
        "show-actions": { alias: ["s4"], type: "boolean", desc: "display actions" },
        "show-mutations": { alias: ["s5"], type: "boolean", desc: "display mutations" },
    })
    .coerce("_", (prs: (number|string)[]) => flatten(prs.map(pr => {
        if (typeof pr === "number") return pr;
        if (pr.match(/^\d+$/)) return +pr;
        const m = pr.match(/^(\d+)-(\d+)$/);
        if (!m) throw new Error(`bad PR or PR range argument: "${pr}"`);
        const lo = +m[1]!, hi = +m[2]!;
        return new Array(hi - lo + 1).map((empty, i) => lo + i);
    })))
    .help("h").alias("h", "help")
    .strict()
    .argv;

const xform = (x: unknown, xlate: (s: string) => string): unknown => {
    if (typeof x === "string") return xlate(x);
    if (typeof x !== "object" || x === null) return x;
    if (Array.isArray(x)) return x.map(e => xform(e, xlate));
    const o = x as { [k: string]: unknown };
    return Object.fromEntries(Object.keys(o).map(k => [k, xform(o[k], xlate)]));
};

const show = (name: string, value: unknown) => {
    console.log(`  === ${name} ===`);
    value = xform(value, (s: string) =>
        s.replace(/\n---+\s*<details><summary>(Diagnostic Information)[^]*?<\/details>/g, "...$1..."));
    let str = args.format === "json" ? JSON.stringify(value, undefined, 2)
        : args.format === "yaml" ? render(value)
        : inspect(value, { depth: null, colors: true });
    str = str.replace(/^/mg, "  ");
    console.log(str);
};

const start = async function () {
    console.log(`Getting open PRs.`);
    const prs = args._.length ? args._ : await getAllOpenPRs();
    //
    for (const pr of prs) {
        console.log(`Processing #${pr} (${prs.indexOf(pr) + 1} of ${prs.length})...`);
        // Generate the info for the PR from scratch
        const info = await queryPRInfo(pr);
        if (args["show-raw"]) show("Raw Query Result", info);
        const prInfo = info.data.repository?.pullRequest;
        // If it didn't work, bail early
        if (!prInfo) {
            console.error(`  No PR with this number exists, (${JSON.stringify(info)})`);
            continue;
        }
        const state = await deriveStateForPR(prInfo);
        if (args["show-basic"]) show("Basic PR Info", state);
        // Show errors in log but keep processing to show in a comment too
        if (state.type === "error") console.error(`  Error: ${state.message}`);
        // Show other messages too
        if ("message" in state) console.log(`  ... ${state.message}`);
        // Convert the info to a set of actions for the bot
        const actions = computeActions(state,
            args["show-extended"] ? i => show("Extended Info", i) : undefined);
        if (args["show-actions"]) show("Actions", actions);
        // Act on the actions
        const mutations = await executePrActions(actions, prInfo, args.dry);
        if (args["show-mutations"] ?? args.dry) show("Mutations", mutations);
    }
    if (args.dry || !args.cleanup || args._.length) return;
    //
    console.log("Cleaning up cards");
    const columns = await getProjectBoardCards();
    const deleteObject = async (id: string, shoulda?: string) => {
        if (shoulda) {
            // don't automatically delete these, eg, PRs that were created
            // during the scan would end up here.
            return console.log(`  Should delete "${id}" (${shoulda})`);
        }
        const mutation = createMutation<schema.DeleteProjectCardInput>("deleteProjectCard", { cardId: id });
        await client.mutate(mutation);
    };
    // Reduce "Recently Merged"
    {
        const recentlyMerged = columns.find(c => c.name === "Recently Merged");
        if (!recentlyMerged) {
            throw new Error(`Could not find the 'Recently Merged' column in ${columns.map(n => n.name)}`);
        }
        const { cards, totalCount } = recentlyMerged;
        const afterFirst50 = cards.sort((l, r) => l.updatedAt.localeCompare(r.updatedAt)).slice(50);
        if (afterFirst50.length > 0) {
            console.log(`Cutting "Recently Merged" projects to the last 50`);
            if (cards.length < totalCount) {
                console.warn(`  *** Note: ${totalCount - cards.length} cards were not seen by this query!`);
            }
            for (const card of afterFirst50) await deleteObject(card.id);
        }
    }
    // Handle other columns
    for (const column of columns) {
        if (column.name === "Recently Merged") continue;
        const ids = column.cards.filter(c => c.number && !prs.includes(c.number)).map(c => c.id);
        if (ids.length === 0) continue;
        console.log(`Cleaning up closed PRs in "${column.name}"`);
        // don't actually do the deletions, until I follow this and make sure that it's working fine
        for (const id of ids) {
            const info = await runQueryToGetPRForCardId(id);
            await deleteObject(id, info === undefined ? "???"
                               : info.state === "CLOSED" ? undefined
                               : "#" + info.number);
        }
    }
    console.log("Done");
};

start();
