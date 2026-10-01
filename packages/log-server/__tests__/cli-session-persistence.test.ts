import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { expect, it } from 'vitest';
import { apiMediaType } from '../src/api.ts';

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(packageDir, 'dist', 'cli.js');

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Could not allocate a test port');
  }
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

// The port is free when picked but another process can take it before the CLI
// binds it, so retry on a fresh port when the CLI exits before listening.
async function startServer(
  database: string,
): Promise<{ child: ChildProcess; port: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await unusedPort();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        'start',
        '--database',
        database,
        '--port',
        String(port),
        '--session-key',
        'test-session-key',
        '--session-max-age-days',
        '7',
        '--same-origin',
      ],
      { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
    );
    if (await printsOutput(child, 'Listening on port')) return { child, port };
  }
  throw new Error('CLI could not bind a port');
}

// Resolves false if the child's stdout closes (it exited) first.
async function printsOutput(child: ChildProcess, text: string) {
  let output = '';
  for await (const chunk of child.stdout!) {
    output += String(chunk);
    if (output.includes(text)) return true;
  }
  return false;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

it('CLI sessions and browser cookies survive a restart', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lightmill-sessions-'));
  const database = path.join(directory, 'data.sqlite');
  let child: ChildProcess | undefined;
  try {
    let port: number;
    ({ child, port } = await startServer(database));
    let baseUrl = `http://127.0.0.1:${port}`;
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': apiMediaType },
      body: JSON.stringify({
        data: { type: 'sessions', attributes: { role: 'participant' } },
      }),
    });
    expect(response.status).toBe(201);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('Expires=');
    const expires = setCookie?.match(/Expires=([^;]+)/)?.[1];
    expect(expires).toBeDefined();
    const daysUntilExpiry =
      (new Date(expires!).getTime() - Date.now()) / 86_400_000;
    expect(daysUntilExpiry).toBeGreaterThan(6.9);
    expect(daysUntilExpiry).toBeLessThan(7.1);
    const cookie = setCookie?.split(';', 1)[0];
    expect(cookie).toBeTruthy();

    await stopServer(child);
    child = undefined;
    // Cookies are not scoped to a port, so the restart may use a different one.
    ({ child, port } = await startServer(database));
    baseUrl = `http://127.0.0.1:${port}`;
    const restored = await fetch(`${baseUrl}/sessions/current`, {
      headers: { cookie: cookie! },
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.attributes.role).toBe('participant');
  } finally {
    if (child !== undefined) await stopServer(child);
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
