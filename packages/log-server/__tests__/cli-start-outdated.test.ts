import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = url.fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const startArgs = (database: string) => [
  cliPath,
  'start',
  '--database',
  database,
  '--port',
  '0',
  '--session-key',
  'test-session-key',
];

describe('start', () => {
  it('fails when the database is missing', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-nodb-'));
    try {
      const database = path.join(directory, 'data.sqlite');
      const result = spawnSync(process.execPath, startArgs(database), {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('does not exist');
      expect(existsSync(database)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails when the database has pending migrations', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-old-'));
    try {
      const database = path.join(directory, 'data.sqlite');
      // An empty file is a valid SQLite database with no schema.
      writeFileSync(database, '');
      const result = spawnSync(process.execPath, startArgs(database), {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('needs migrating');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
