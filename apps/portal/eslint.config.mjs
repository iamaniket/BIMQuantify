import { fileURLToPath } from 'node:url';
import path from 'node:path';

import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import nextPlugin from '@next/eslint-plugin-next';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: dirname,
  recommendedConfig: js.configs.recommended,
});

const airbnbExtends = compat.extends('airbnb-base');

// Next.js + React wired as NATIVE flat config. This replaces the previous
// `compat.extends('next/core-web-vitals')`, which crashes ESLint 9 at
// config-load: eslint-plugin-react 7.37's circular `configs` object makes
// @eslint/eslintrc's config-validator throw "Converting circular structure to
// JSON" when it formats a schema-validation error. Registering the plugins
// directly skips that legacy eslintrc validator path. Mirrors the rule set the
// `next/core-web-vitals` extend provided (react + hooks + a11y + next).
const reactAndNext = {
  plugins: {
    react: reactPlugin,
    'react-hooks': reactHooks,
    'jsx-a11y': jsxA11y,
    '@next/next': nextPlugin,
  },
  settings: { react: { version: 'detect' } },
  rules: {
    ...reactPlugin.configs.flat.recommended.rules,
    ...reactPlugin.configs.flat['jsx-runtime'].rules,
    ...reactHooks.configs.recommended.rules,
    ...jsxA11y.configs.recommended.rules,
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
  },
};

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
      'tailwind.config.ts',
      'scripts/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...airbnbExtends,
  reactAndNext,
  i18next.configs['flat/recommended'],
  {
    // 'error': the existing JSX-text hardcodes have been migrated through
    // useTranslations() / @bimdossier/i18n, so any NEW literal JSX text now
    // fails CI instead of merely warning. Brand wordmarks, version badges and
    // decorative glyphs that are genuinely language-neutral are written as
    // expression-container literals (e.g. {'BimDossier'}, {'●'}), which this
    // rule's default 'jsx-text-only' mode does not flag. The rule guards JSX
    // text, not attributes (aria-label/placeholder/title).
    rules: {
      'i18next/no-literal-string': ['error', {
        message: 'String literals in JSX must be routed through useTranslations() or @bimdossier/i18n shared catalog.',
      }],
    },
  },
  {
    // Literals are allowed in: test assertions and skeuomorphic art (raw
    // brand label baked into a fake keyboard / mouse diagram, per
    // CLAUDE.md exception).
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'tests/**',
      'src/__tests__/**',
      'src/components/shared/viewer/shared/settings/VisualKeyboard.tsx',
      'src/components/shared/viewer/shared/settings/MouseDiagram.tsx',
      // Catastrophic fallback — replaces the root layout, so it can't reach the
      // i18n provider and uses minimal hardcoded copy.
      'src/app/**/global-error.tsx',
    ],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
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
      // The repo is CRLF on Windows (git normalizes EOL on commit), so
      // airbnb-base's `linebreak-style: ['error','unix']` is pure noise here
      // — it accounted for ~85% of all reported problems. EOL is a git concern,
      // not a lint concern.
      'linebreak-style': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/forbid-elements': ['error', {
        forbid: [
          {
            element: 'select',
            message: 'Raw <select> is banned. Use the shared <Select> from @bimdossier/ui so the dropdown chevron is applied automatically.',
          },
          {
            element: 'textarea',
            message: 'Raw <textarea> is banned. Use the shared <Textarea> from @bimdossier/ui.',
          },
        ],
      }],
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
  {
    // The base <Select> (@bimdossier/ui) is the only sanctioned select; it
    // bakes in the dropdown chevron. Test mocks legitimately render a raw
    // <select>, so the forbid-elements guard is disabled for test files.
    // Placed last so it overrides the project-wide 'error' above.
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'tests/**',
      'src/__tests__/**',
    ],
    rules: {
      'react/forbid-elements': 'off',
    },
  },
);
