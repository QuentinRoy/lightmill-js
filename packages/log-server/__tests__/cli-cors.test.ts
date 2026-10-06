import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';

// These tests run the built CLI, so they need a fresh build (`pnpm build`).

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');

let directory: string;
let database: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-cors-'));
  database = path.join(directory, 'data.sqlite');
  await SQLiteDataStore.migrateDatabase(database);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function cliArguments(...extra: string[]) {
  return [
    cliPath,
    'start',
    '--database',
    database,
    // Port 0 lets the OS pick a free port when the CLI binds it.
    '--port',
    '0',
    '--session-key',
    'test-session-key',
    ...extra,
  ];
}

// An inherited ALLOWED_ORIGINS or LOG_LEVEL would change what the CLI does.
const env = {
  ...process.env,
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  ALLOWED_ORIGINS: '',
};

async function withServer(
  extra: string[],
  run: (baseUrl: string) => Promise<void>,
  serverEnv: NodeJS.ProcessEnv = env,
) {
  const child: ChildProcess = spawn(process.execPath, cliArguments(...extra), {
    stdio: 'pipe',
    env: serverEnv,
  });
  try {
    let output = '';
    let port: number | undefined;
    for await (const chunk of child.stdout!) {
      output += String(chunk);
      const match = /Listening on port (\d+)/.exec(output);
      if (match != null) {
        port = Number(match[1]);
        break;
      }
    }
    if (port === undefined) throw new Error('CLI exited before listening');
    await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
}

async function preflight(baseUrl: string, origin: string) {
  return fetch(`${baseUrl}/runs`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
}

describe('log-server start', () => {
  it('refuses to start without an allowed origin or --same-origin', () => {
    const result = spawnSync(process.execPath, cliArguments(), {
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('--allowed-origin');
    expect(result.stderr + result.stdout).toContain('--same-origin');
  });

  it('rejects an allowed origin that browsers would never send', () => {
    const result = spawnSync(
      process.execPath,
      cliArguments('--allowed-origin', 'http://localhost:5173/'),
      { env, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('Invalid allowed origin');
  });

  it('allows credentialed requests from an allowed origin only', async () => {
    await withServer(
      [
        '--allowed-origin',
        'https://one.example',
        '--allowed-origin',
        'http://localhost:5173',
      ],
      async (baseUrl) => {
        for (const origin of ['https://one.example', 'http://localhost:5173']) {
          const allowed = await preflight(baseUrl, origin);
          expect(allowed.headers.get('access-control-allow-origin')).toBe(
            origin,
          );
          expect(allowed.headers.get('access-control-allow-credentials')).toBe(
            'true',
          );
          expect(allowed.headers.get('vary')).toContain('Origin');
        }
        const refused = await preflight(baseUrl, 'https://evil.example');
        expect(refused.headers.get('access-control-allow-origin')).toBeNull();
      },
    );
  });

  it('reads allowed origins from ALLOWED_ORIGINS', async () => {
    await withServer(
      [],
      async (baseUrl) => {
        for (const origin of ['https://one.example', 'https://two.example']) {
          const response = await preflight(baseUrl, origin);
          expect(response.headers.get('access-control-allow-origin')).toBe(
            origin,
          );
        }
      },
      { ...env, ALLOWED_ORIGINS: 'https://one.example, https://two.example' },
    );
  });

  it('combines --same-origin with an allowed origin', async () => {
    await withServer(
      ['--same-origin', '--allowed-origin', 'http://localhost:5173'],
      async (baseUrl) => {
        const response = await preflight(baseUrl, 'http://localhost:5173');
        expect(response.headers.get('access-control-allow-origin')).toBe(
          'http://localhost:5173',
        );
        expect(response.headers.get('access-control-allow-credentials')).toBe(
          'true',
        );
      },
    );
  });

  it('adds no CORS headers with only --same-origin', async () => {
    await withServer(['--same-origin'], async (baseUrl) => {
      const response = await preflight(baseUrl, 'http://localhost:5173');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
}, 15_000);
