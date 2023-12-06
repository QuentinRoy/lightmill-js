import { resolve } from 'node:path';
import * as url from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    root: resolve(dirname),
    globals: false,
    include: ['**/__tests__/*.test.ts'],
    typecheck: {
      checker: 'tsc',
      ignoreSourceErrors: true,
    },
  },
});
