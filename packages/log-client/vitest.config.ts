import { resolve } from 'node:path';
import * as url from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    root: resolve(dirname),
    globals: true,
    include: ['**/__tests__/*.test.ts'],
    setupFiles: './__tests__/setup.ts',
  },
});
