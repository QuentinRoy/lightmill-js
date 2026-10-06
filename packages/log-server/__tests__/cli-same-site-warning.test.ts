import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hostPasswordArguments } from './__fixtures__/test-utils.ts';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-cli-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

// The database does not exist, so `start` exits right after the checks that
// precede opening it, which is where the warning belongs.
function start(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      cliPath,
      'start',
      '--database',
      path.join(directory, 'data.sqlite'),
      '--port',
      '0',
      '--session-key',
      'test-session-key',
      ...hostPasswordArguments,
      ...args,
    ],
    {
      encoding: 'utf8',
      // An empty directory keeps a developer's `.env` file out of the run.
      cwd: directory,
    },
  );
}

it('start warns when --same-site runs without --trust-proxy', () => {
  let result = start(['--same-site']);
  expect(result.stderr).toContain('--trust-proxy');
});

it('start does not warn about --trust-proxy when it is set', () => {
  let result = start(['--same-site', '--trust-proxy']);
  expect(result.stderr).not.toContain('--trust-proxy');
});

it('start does not warn about --trust-proxy without --same-site', () => {
  let result = start(['--allowed-origin', 'https://example.org']);
  expect(result.stderr).not.toContain('--trust-proxy');
});
