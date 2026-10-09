/// <reference types="vitest" />
/// <reference types="vite/client" />

import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import * as url from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    root: resolve(dirname),
    globals: true,
    include: ['**/__tests__/*.test.ts', '**/__tests__/*.test.tsx'],
    setupFiles: './__tests__/setup.ts',
    server: {
      // The log server runs in Node: jsdom's `URL` is not the one it expects.
      deps: { external: [/\/packages\/log-server\//] },
    },
  },
});
