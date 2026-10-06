import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostCredentials } from './__fixtures__/test-utils.ts';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const commands = {
  start: [
    'start',
    '--port',
    '0',
    '--session-key',
    'test-session-key',
    '--host-password',
    hostCredentials.password,
  ],
  export: ['export'],
};

// Runs a command against a database path in a fresh directory. `prepare` may
// create the file beforehand.
function run(
  command: keyof typeof commands,
  prepare?: (database: string) => void,
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-cli-'));
  const database = path.join(directory, 'data.sqlite');
  try {
    prepare?.(database);
    const result = spawnSync(
      process.execPath,
      [cliPath, ...commands[command], '--database', database],
      { encoding: 'utf8' },
    );
    return { ...result, databaseCreated: existsSync(database) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.for(['start', 'export'] as const)('%s', (command) => {
  it('fails when the database is missing', () => {
    const result = run(command);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not exist');
    expect(result.databaseCreated).toBe(false);
  });

  it('fails when the database has pending migrations', () => {
    // An empty file is a valid SQLite database with no schema.
    const result = run(command, (database) => writeFileSync(database, ''));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('log-server migrate');
  });
});
