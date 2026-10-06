import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import { hostPasswordArguments } from './__fixtures__/test-utils.ts';

// A repeated scalar option takes its last value. Each test puts a value that
// would fail first, so only the last occurrence can make the command succeed.

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

let directory: string;
let database: string;
let missingDatabase: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-repeated-'));
  database = path.join(directory, 'data.sqlite');
  missingDatabase = path.join(directory, 'missing.sqlite');
  await SQLiteDataStore.migrateDatabase(database);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    cwd: directory,
  });
}

it('start uses the last of repeated options', async () => {
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'start',
      ...['--database', missingDatabase, '--database', database],
      ...['--port', '99999', '--port', '0'],
      ...['--session-key', 'first', '-s', 'second'],
      ...['--session-max-age-days', '-1', '--session-max-age-days', '5'],
      ...hostPasswordArguments,
      ...['--allowed-origin', 'https://one.example'],
      ...['--allowed-origin', 'https://two.example'],
    ],
    { stdio: 'pipe', cwd: directory },
  );
  let output = '';
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  try {
    for await (const chunk of child.stdout) {
      output += String(chunk);
      if (/Listening on port \d+/.test(output)) return;
    }
    throw new Error(`CLI exited before listening: ${output}`);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
});

it('migrate uses the last of repeated options', () => {
  const result = run([
    'migrate',
    ...['--database', path.join(directory, 'migrated.sqlite')],
    ...['-d', path.join(directory, 'migrated-last.sqlite')],
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

it('experiment add uses the last of repeated options', async () => {
  const result = run([
    ...['experiment', 'add', 'repeated'],
    ...['--database', missingDatabase, '--database', database],
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

it('export uses the last of repeated options', () => {
  const result = run([
    'export',
    ...['--database', missingDatabase, '--database', database],
    ...['--logType', 'one', '--logType', 'two'],
    ...['--experimentName', 'one', '--experimentName', 'two'],
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});
