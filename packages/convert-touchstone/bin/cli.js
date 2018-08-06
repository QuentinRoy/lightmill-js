#!/usr/bin/env node

const yargs = require('yargs');
const fs = require('fs');
const convertTouchstone = require('../dist/lightmill-convert-touchstone');

const cliArgs = yargs
  .command(
    '* <input-file>',
    "Convert touchstone files to lightmill's static-runner format",
    yargs_ => {
      yargs_.positional('input-file', {
        describe: 'An xml file as exported by the touchstone design platform'
      });
    }
  )
  .alias('t', 'trials')
  .default('t', 'trial')
  .describe('t', 'The type of the trial tasks')
  .alias('b', 'block-startups')
  .default('b', 'block-startup')
  .describe('b', 'The type of the block startup tasks')
  .describe('no-block-startups', 'Do not insert block startups')
  .help().argv;

convertTouchstone(fs.createReadStream(cliArgs.inputFile), {
  blockStartupType: cliArgs.blockStartups,
  trialType: cliArgs.trials
})
  .then(design => {
    process.stdout.write(JSON.stringify(design, null, 2));
  })
  .catch(error => {
    process.stderr.write(error);
    process.exit(1);
  });
