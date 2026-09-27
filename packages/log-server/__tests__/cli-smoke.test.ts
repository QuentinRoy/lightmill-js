import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';
import { afterAll, expect, it } from 'vitest';

// Runs the bin from the packed tarball, so it tests what gets published
// rather than the sources. It needs a fresh build (`pnpm build`).

const packageDir = url.fileURLToPath(new URL('..', import.meta.url));

// The tarball is unpacked inside node_modules so the bin can resolve the
// package's installed dependencies by walking up the directory tree.
const tmpDir = mkdtempSync(path.join(packageDir, 'node_modules', '.smoke-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

it('the packed log-server command prints its help', () => {
  execFileSync('pnpm', ['pack', '--pack-destination', tmpDir], {
    cwd: packageDir,
    stdio: 'ignore',
  });
  let tarball = readdirSync(tmpDir).find((f) => f.endsWith('.tgz'));
  if (tarball == null) throw new Error('pnpm pack produced no tarball');
  execFileSync('tar', ['-xzf', tarball], { cwd: tmpDir });

  let output = execFileSync(
    'node',
    [path.join(tmpDir, 'package', 'dist', 'start-cli.js'), '--help'],
    { encoding: 'utf8' },
  );
  expect(output).toContain('Usage: log-server <command> [options]');

  let startHelp = execFileSync(
    'node',
    [path.join(tmpDir, 'package', 'dist', 'start-cli.js'), 'start', '--help'],
    { encoding: 'utf8' },
  );
  expect(startHelp).toContain('--same-origin');
}, 30_000);
