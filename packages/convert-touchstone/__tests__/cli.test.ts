import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as url from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import convertTouchstone from '../src/convert-touchstone.ts';

const run = promisify(execFile);
const dirname = url.fileURLToPath(new URL('.', import.meta.url));
const cliPath = resolve(dirname, '../bin/cli.mjs');
const fixturePath = resolve(
  dirname,
  '__fixtures__/convert-touchstone.test.xml',
);

// The command runs the built package (`pnpm build` first) in plain Node, which
// Vitest's own module handling does not reproduce.
describe('command line tool', () => {
  it('prints what convertTouchstone returns for the same file', async () => {
    const { stdout } = await run(process.execPath, [cliPath, fixturePath]);
    const expected = await convertTouchstone(
      await readFile(fixturePath, 'utf-8'),
    );
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  it('passes its options to convertTouchstone', async () => {
    const { stdout } = await run(process.execPath, [
      cliPath,
      fixturePath,
      '--pre-runs',
      'pre-run',
      '--trials',
      'my-trial',
    ]);
    const types = new Set(
      JSON.parse(stdout).runs.flatMap((run: { timeline: { type: string }[] }) =>
        run.timeline.map((task) => task.type),
      ),
    );
    expect(types).toEqual(new Set(['pre-run', 'my-trial']));
  });

  it('refuses an unknown option', async () => {
    await expect(
      run(process.execPath, [cliPath, fixturePath, '--unknown']),
    ).rejects.toMatchObject({ code: 1 });
  });
});
