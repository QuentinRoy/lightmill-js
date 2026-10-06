import { mediaType } from '@lightmill/log-api/vocabulary';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLiteDataStore } from '../src/sqlite-data-store.ts';
import { hostPasswordArguments } from './__fixtures__/test-utils.ts';

// These tests run the built CLI, so they need a fresh build (`pnpm build`).

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');
const env = { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' };

let directory: string;
let database: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-secure-'));
  database = path.join(directory, 'data.sqlite');
  await SQLiteDataStore.migrateDatabase(database);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function cliArguments(extra: string[]) {
  return [
    cliPath,
    'start',
    '--database',
    database,
    '--port',
    '0',
    '--session-key',
    'test-session-key',
    ...hostPasswordArguments,
    ...extra,
  ];
}

// `Secure` cookies are only sent over HTTPS, so the requests claim to come
// through a TLS-terminating proxy.
async function sessionCookie(extra: string[], protocol: 'http' | 'https') {
  const child: ChildProcess = spawn(
    process.execPath,
    cliArguments([...extra, '--trust-proxy']),
    { stdio: 'pipe', env },
  );
  try {
    let output = '';
    for await (const chunk of child.stdout!) {
      output += String(chunk);
      const match = /Listening on port (\d+)/.exec(output);
      if (match == null) continue;
      const response = await fetch(`http://127.0.0.1:${match[1]}/sessions`, {
        method: 'POST',
        headers: { 'content-type': mediaType, 'x-forwarded-proto': protocol },
        body: JSON.stringify({
          data: { type: 'sessions', attributes: { role: 'participant' } },
        }),
      });
      expect(response.status).toBe(201);
      return response.headers.get('set-cookie');
    }
    throw new Error('CLI exited before listening');
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
}

describe('log-server start --secure-cookies', () => {
  it('forces Secure cookies', async () => {
    const cookie = await sessionCookie(
      ['--same-site', '--secure-cookies', 'always'],
      'https',
    );
    expect(cookie).toContain('; Secure;');
  });

  it('follows the request protocol with auto, the same-site default', async () => {
    for (const extra of [[], ['--secure-cookies', 'auto']]) {
      const args = ['--same-site', ...extra];
      expect(await sessionCookie(args, 'https')).toContain('; Secure;');
      expect(await sessionCookie(args, 'http')).not.toContain('Secure');
    }
  });

  it('turns Secure off with never', async () => {
    const cookie = await sessionCookie(
      ['--same-site', '--secure-cookies', 'never'],
      'https',
    );
    expect(cookie).not.toContain('Secure');
  });

  it('keeps cross-site cookies Secure', async () => {
    const cookie = await sessionCookie(
      ['--allowed-origin', 'https://one.example', '--secure-cookies', 'always'],
      'https',
    );
    expect(cookie).toContain('; Secure;');
  });

  it.each(['auto', 'never'])('rejects %s without --same-site', (value) => {
    const result = spawnSync(
      process.execPath,
      cliArguments([
        '--allowed-origin',
        'https://one.example',
        '--secure-cookies',
        value,
      ]),
      { env, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('requires --same-site');
  });

  it('rejects an unknown value', () => {
    const result = spawnSync(
      process.execPath,
      cliArguments(['--same-site', '--secure-cookies', 'sometimes']),
      { env, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Invalid values');
  });

  it('uses the last of a repeated option', async () => {
    const cookie = await sessionCookie(
      [
        '--same-site',
        '--secure-cookies',
        'always',
        '--secure-cookies',
        'never',
      ],
      'https',
    );
    expect(cookie).not.toContain('Secure');
  });
});
