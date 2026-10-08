import js from '@eslint/js';
import { Linter } from 'eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import compat from 'eslint-plugin-compat';
import jsdoc from 'eslint-plugin-jsdoc';
import reactPlugin from 'eslint-plugin-react';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '*.DS_Store',
      '**/node_modules',
      'packages/**/dist/*',
      '**/coverage',
      '**/*.snap',
      // Each agent worktree is a full checkout with its own eslint config.
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],
  jsdoc.configs['flat/contents-typescript'],
  eslintConfigPrettier,
  {
    settings: {
      react: {
        // This may need to be updated if we update react.
        version: '18.2',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // The ponytail agent plugin tags its shortcuts this way; plain comments
      // explaining why are the convention here.
      'no-warning-comments': [
        'error',
        { terms: ['ponytail:'], location: 'anywhere' },
      ],
      'class-methods-use-this': 'off',
      'prefer-const': 'off',
      'no-redeclare': 'off',
      // We need to use no-redeclare from typescript-eslint otherwise
      // we cannot use ts function overloads.
      '@typescript-eslint/no-redeclare': [
        'error',
        { ignoreDeclarationMerge: false },
      ],
    },
  },
  {
    files: ['packages/**/src/**/*@(.mjs|.js|.ts|.cjs|.jsx|.tsx)'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['packages/log-server/__tests__/**/*.ts'],
    ignores: ['packages/log-server/__tests__/__fixtures__/test-utils.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'supertest',
              message:
                'Use createClient from test-utils: it checks every response against the API.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // log-client ships untranspiled to the browsers in its browserslist.
    ...compat.configs['flat/recommended'],
    files: ['packages/log-client/src/**/*.ts'],
    settings: { lintAllEsApis: true },
  },
  {
    files: ['*.cjs'],
    languageOptions: { sourceType: 'script', globals: { ...globals.node } },
  },
  {
    files: [
      'packages/**/bin/**/*@(.mjs|.js|.ts|.cjs)',
      'scripts/**/*@(.mjs|.js|.ts|.cjs)',
      'packages/**/scripts/**/*@(.mjs|.js|.ts|.cjs)',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
) as Linter.Config[];
