#!/usr/bin/env node

import { command } from 'yargs';
import { createReadStream } from 'fs';
import convertTouchstone from '../dist/convert-touchstone.js';

const { inputFile, ...options } = command(
  '* <input-file> [options]',
  "Convert touchstone files to lightmill's static-runner format",
  (yargs_) => {
    yargs_.positional('input-file', {
      describe: 'An xml file as exported by the touchstone design platform',
    });
  }
)
  .option('trials', {
    alias: 't',
    default: 'trial',
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
  .help().argv;

try {
  const design = await convertTouchstone(createReadStream(inputFile), options);
  process.stdout.write(JSON.stringify(design, null, 2));
} catch (error) {
  process.stderr.write(error);
  process.exit(1);
}
