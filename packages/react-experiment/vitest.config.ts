import { resolve } from 'node:path';
import * as url from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // @ts-expect-error This is badly typed.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    root: resolve(dirname),
    globals: true,
    include: ['**/__tests__/*.test.ts', '**/__tests__/*.test.tsx'],
    setupFiles: './__tests__/setup.ts',
  },
});
