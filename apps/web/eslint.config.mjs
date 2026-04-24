import { fileURLToPath } from 'node:url';
import path from 'node:path';

import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: dirname,
  recommendedConfig: js.configs.recommended,
});

const airbnbExtends = compat.extends('airbnb-base');

const nextExtends = compat.extends('next/core-web-vitals');

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'eslint.config.mjs',
      'postcss.config.mjs',
      'next.config.mjs',
      'playwright.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...airbnbExtends,
  ...nextExtends,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tests/tsconfig.json'],
        tsconfigRootDir: dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSPropertySignature[optional=true]',
          message: 'Optional property syntax (prop?:) is banned. Use `prop: T | undefined`.',
        },
        {
          selector: 'TSMethodSignature[optional=true]',
          message: 'Optional method syntax (method?:) is banned. Declare it explicitly.',
        },
        {
          selector: 'ChainExpression',
          message: 'Optional chaining (?.) is discouraged. Narrow with explicit checks.',
        },
      ],
      'import/prefer-default-export': 'off',
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-filename-extension': ['error', { extensions: ['.tsx'] }],
      'react/jsx-props-no-spreading': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      'dot-notation': 'off',
      '@typescript-eslint/dot-notation': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-restricted-syntax': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  },
);
