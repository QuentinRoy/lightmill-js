import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

function publint(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('publint', [path]);
    child.stdout.on('data', (data) => {
      console.log(data.toString());
    });

    child.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(code);
      } else {
        resolve(code);
      }
    });
  });
}

async function publintAll() {
  let hasError = false;
  for (const packagePath of await readdir('./packages')) {
    if (packagePath.startsWith('.')) {
      continue;
    }
    await publint(`./packages/${packagePath}`).catch(() => {
      hasError = true;
    });
  }

  if (hasError) {
    throw new Error('publint failed');
  }
}

const [path] = parseArgs({ allowPositionals: true }).positionals;

if (path == null) {
  publintAll().catch(() => {
    process.exit(1);
  });
} else {
  publint(path).catch(() => {
    process.exit(1);
  });
}
