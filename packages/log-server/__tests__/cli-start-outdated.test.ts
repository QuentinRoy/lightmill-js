import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// Runs `start` against a database path in a fresh directory. `prepare` may
// create the file beforehand.
function runStart(prepare?: (database: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-start-'));
  const database = path.join(directory, 'data.sqlite');
  try {
    prepare?.(database);
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'start',
        '--database',
        database,
        '--port',
        '0',
        '--session-key',
        'test-session-key',
      ],
      { encoding: 'utf8' },
    );
    return { ...result, databaseCreated: existsSync(database) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it('start fails when the database is missing', () => {
  const result = runStart();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('does not exist');
  expect(result.databaseCreated).toBe(false);
});

it('start fails when the database has pending migrations', () => {
  // An empty file is a valid SQLite database with no schema.
  const result = runStart((database) => writeFileSync(database, ''));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('needs migrating');
});
