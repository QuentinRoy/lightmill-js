import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactPlugin from 'eslint-plugin-react';
import { Linter } from 'eslint';

export default tseslint.config(
  {
    ignores: [
      '*.DS_Store',
      '**/node_modules',
      'packages/**/dist/*',
      '**/coverage',
      '**/*.snap',
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
        'warn',
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
      'class-methods-use-this': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['packages/**/src/**/*@(.mjs|.js|.ts|.cjs|.jsx|.tsx)'],
    rules: { 'no-console': 'error' },
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
