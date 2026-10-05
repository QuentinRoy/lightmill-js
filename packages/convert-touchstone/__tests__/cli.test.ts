import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as url from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import convertTouchstone from '../src/convert-touchstone.ts';

const execFileAsync = promisify(execFile);
const dirname = url.fileURLToPath(new URL('.', import.meta.url));
const cliPath = resolve(dirname, '../bin/cli.mjs');
const fixturePath = resolve(
  dirname,
  '__fixtures__/convert-touchstone.test.xml',
);

function runCli(...args: Array<string>) {
  return execFileAsync(process.execPath, [cliPath, fixturePath, ...args]);
}

// The command runs the built package (`pnpm build` first) in plain Node, which
// Vitest's own module handling does not reproduce.
describe('command line tool', () => {
  it('prints what convertTouchstone returns for the same file', async () => {
    const { stdout } = await runCli();
    const xml = await readFile(fixturePath, 'utf-8');
    expect(JSON.parse(stdout)).toEqual(await convertTouchstone(xml));
  });

  it('passes its options to convertTouchstone', async () => {
    const { stdout } = await runCli('--pre-runs', 'pre-run', '--trials', 'tr');
    const xml = await readFile(fixturePath, 'utf-8');
    const expected = await convertTouchstone(xml, {
      preRun: 'pre-run',
      trial: 'tr',
    });
    expect(JSON.parse(stdout)).toEqual(expected);
    // Guards against the options being ignored: the defaults differ.
    expect(JSON.parse(stdout)).not.toEqual(await convertTouchstone(xml));
  });

  it('refuses an unknown option', async () => {
    await expect(runCli('--unknown')).rejects.toMatchObject({ code: 1 });
  });
});
