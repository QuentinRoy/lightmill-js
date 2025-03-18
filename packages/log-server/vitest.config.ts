import { resolve } from 'node:path';
import * as url from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    server: {
      deps: {
        // Kysely will load migrations files which are written in TypeScript.
        // Inlining it should let vitest process them.
        inline: ['kysely'],
      },
    },
    environment: 'node',
    include: ['**/__tests__/*.test.ts'],
    root: resolve(dirname),
    typecheck: { enabled: true, ignoreSourceErrors: true },
  },
});
