import { resolve } from 'node:path';
import * as url from 'node:url';
import { defineProject } from 'vitest/config';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

export default defineProject({
  server: {
    watch: {
      // This are the default values with dist omitted because we do run some of
      // the tests against the dist build.
      ignored: ['**/node_modules/**'],
    },
  },
  test: {
    environment: 'node',
    include: ['**/__tests__/*.test.ts'],
    root: resolve(dirname),
    typecheck: {
      checker: 'tsc',
      ignoreSourceErrors: true,
    },
  },
});
