#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import convertTouchstone from '../dist/convert-touchstone.js';

const { inputFile, trials, preBlocks, postBlocks, preRuns, postRuns } =
  await yargs(hideBin(process.argv))
    .command(
      '$0 <input-file>',
      "Convert touchstone files to lightmill's static-runner format",
      (yargs_) =>
        yargs_.positional('input-file', {
          describe: 'An xml file as exported by the touchstone design platform',
          type: 'string',
        }),
    )
    .option('trials', {
      alias: 't',
      type: 'string',
      describe: 'The type of the trial tasks',
    })
    .option('pre-blocks', {
      alias: 'b',
      type: 'string',
      describe: 'The type of the task to insert before each block',
    })
    .option('post-blocks', {
      alias: 'k',
      type: 'string',
      describe: 'The type of the task to insert after each block',
    })
    .option('pre-runs', {
      alias: 'r',
      type: 'string',
      describe: 'The type of the task to insert before each run',
    })
    .option('post-runs', {
      alias: 'n',
      type: 'string',
      describe: 'The type of the tasks to insert after each run',
    })
    .strict()
    .help()
    .parseAsync();

try {
  const design = await convertTouchstone(createReadStream(inputFile), {
    trial: trials,
    preBlock: preBlocks,
    postBlock: postBlocks,
    preRun: preRuns,
    postRun: postRuns,
  });
  process.stdout.write(JSON.stringify(design, null, 2));
} catch (error) {
  console.error(error);
  process.exit(1);
}
