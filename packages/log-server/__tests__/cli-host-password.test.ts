import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-cli-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function start(args: string[], env: Record<string, string> = {}) {
  // An empty directory keeps a developer's `.env` file out of the run.
  const { HOST_PASSWORD: _, ...inheritedEnv } = process.env;
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
      ...args,
    ],
    { encoding: 'utf8', cwd: directory, env: { ...inheritedEnv, ...env } },
  );
}

it.for([
  { name: 'is not set', args: [], env: {} },
  { name: 'is empty', args: ['--host-password', ''], env: {} },
  { name: 'is an empty HOST_PASSWORD', args: [], env: { HOST_PASSWORD: '' } },
])('start refuses to run if the host password $name', ({ args, env }) => {
  const result = start(args, env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No host password set');
});
