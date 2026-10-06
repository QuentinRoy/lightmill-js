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

const sessionKeyArguments = ['--session-key', 'test-session-key'];

function start(args: string[], env: Record<string, string> = {}) {
  // The CLI also reads these from the environment.
  const {
    HOST_PASSWORD: _hostPassword,
    SESSION_KEY: _sessionKey,
    ...inheritedEnv
  } = process.env;
  return spawnSync(
    process.execPath,
    [
      cliPath,
      'start',
      '--database',
      path.join(directory, 'data.sqlite'),
      '--port',
      '0',
      ...args,
    ],
    {
      encoding: 'utf8',
      // An empty directory keeps a developer's `.env` file out of the run.
      cwd: directory,
      env: { ...inheritedEnv, ...env },
    },
  );
}

it.for([
  { name: 'is not set', args: [], env: {} },
  { name: 'is empty', args: ['--host-password', ''], env: {} },
  { name: 'is an empty HOST_PASSWORD', args: [], env: { HOST_PASSWORD: '' } },
])('start refuses to run if the host password $name', ({ args, env }) => {
  const result = start([...sessionKeyArguments, ...args], env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No host password set');
});

it('start refuses a host password given twice', () => {
  const result = start([
    ...sessionKeyArguments,
    '--host-password',
    'one',
    '--host-password',
    'two',
  ]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Pass --host-password only once');
});

it('start reports a missing session key before a missing host password', () => {
  const result = start([]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No session key set');
});

// The database does not exist, so a start that gets past the password checks
// fails on that instead.
it.for([
  { name: '--host-password', args: ['--host-password', 'secret'], env: {} },
  { name: 'HOST_PASSWORD', args: [], env: { HOST_PASSWORD: 'secret' } },
])('start accepts a host password from $name', ({ args, env }) => {
  const result = start([...sessionKeyArguments, '--same-origin', ...args], env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('does not exist');
  expect(result.stderr).not.toContain('host password');
});
