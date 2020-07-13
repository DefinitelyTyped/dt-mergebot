import processSingle from "./process-single";
import { getProcessManyPRs } from "../queries/process-many-query";
import { formatMutationRequest } from "../util/formatMutationRequest";

interface ProcessManyOptions {
  dry?: boolean;
  dateRange: {
    startTime: Date;
    endTime?: Date;
  };
}

async function main({ dateRange, dry }: ProcessManyOptions) {
  const prs = await getProcessManyPRs(dateRange.startTime, dateRange.endTime);
  const results = [];

  try {
    for (const pr of prs) {
      console.log(`Processing #${pr} (${prs.indexOf(pr) + 1} of ${prs.length})...`);
      const result = await processSingle(pr, () => {}, dry);
      if (result.length) {
        results.push({ pr, mutations: result });
      }
    }
  } catch (err) {
    reportResults(results, prs.length, dry);
    throw err;
  }

  reportResults(results, prs.length, dry);
}

function reportResults(results: { pr: number, mutations: string[] }[], prCount: number, dry?: boolean) {
  console.log((dry ? 'Found' : 'Performed') + ` actions for ${results.length} of ${prCount} recently updated PRs.`);
  console.log('');
  for (const { pr, mutations } of results) {
    console.log(`=== https://github.com/DefinitelyTyped/DefinitelyTyped/pull/${pr} ===`);
    console.log(mutations.map(formatMutationRequest).join('\n\n'));
    console.log('');
  }
}

if (!module.parent) {
  const hoursAgoIndex = process.argv.indexOf('--since-hours-ago');
  if (hoursAgoIndex < 0) throw new Error(`Must supply '--since-hours-ago' argument. 'npm run many -- --since-hours-ago 24`);
  const hoursAgo = +process.argv[hoursAgoIndex + 1];
  if (isNaN(hoursAgo)) throw new Error(`Could not parse '${process.argv[hoursAgoIndex + 1]}' as a number.`);
  const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const dry = process.argv.indexOf('--dry') > -1;

  main({ dry, dateRange: { startTime } }).then(() => {
    console.log('Done!');
    process.exit(0);
  }, err => {
    if (err && err.stack) {
      console.error(err.stack);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
