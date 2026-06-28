/**
 * Shared ESLint flat config for BimDossier Next.js apps (portal, web).
 *
 * Division of labour:
 *   - ESLint  → correctness + team conventions (this file)
 *   - Prettier → formatting (eslint-config-prettier turns every stylistic rule off below)
 *   - TypeScript → type-safety (tsc --noEmit; exactOptionalPropertyTypes etc.)
 *
 * Deliberately NOT used: airbnb-base (formatting noise), strictTypeChecked (pedantic
 * stylistic type rules), and the old `no-restricted-syntax` block that banned optional
 * chaining `?.` and optional-property `prop?:`. The latter duplicated
 * `exactOptionalPropertyTypes` (still on in packages/tsconfig) — dropping the lint ban
 * changes no compile-time guarantee. See the repo's eslint-overhaul plan for rationale.
 */
import js from '@eslint/js';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const TEST_FILES = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  'tests/**',
  'src/__tests__/**',
];

// React + Next wired as NATIVE flat config (replaces compat.extends('next/core-web-vitals'),
// which crashes ESLint 9 at config-load via eslint-plugin-react 7.37's circular `configs`).
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

/**
 * Build the flat config for a Next.js app.
 *
 * @param {object}   opts
 * @param {string}   opts.tsconfigRootDir   absolute dir of the app (for type-aware linting)
 * @param {string[]} [opts.projects]        tsconfig paths for parserOptions.project
 * @param {boolean}  [opts.forbidElements]  ban raw <select>/<textarea> (portal: true)
 * @param {string[]} [opts.extraIgnores]    app-specific ignore globs
 * @param {string[]} [opts.i18nAllowFiles]  files exempt from i18next/no-literal-string
 */
export function nextAppConfig({
  tsconfigRootDir,
  projects = ['./tsconfig.json'],
  forbidElements = false,
  extraIgnores = [],
  i18nAllowFiles = [],
}) {
  return tseslint.config(
    {
      ignores: [
        '**/.next/**',
        '**/node_modules/**',
        '**/dist/**',
        'next-env.d.ts',
        'eslint.config.mjs',
        'postcss.config.mjs',
        'next.config.mjs',
        ...extraIgnores,
      ],
    },
    js.configs.recommended,
    // Tier: recommendedTypeChecked (type-aware correctness floor) — NOT strictTypeChecked.
    // Drops the pedantic stylistic-type rules (restrict-template-expressions,
    // no-unnecessary-condition, no-confusing-void-expression, prefer-optional-chain) while
    // keeping the real safety net (no-floating-promises, no-misused-promises, await-thenable,
    // no-unnecessary-type-assertion, …).
    ...tseslint.configs.recommendedTypeChecked,
    reactAndNext,
    i18next.configs['flat/recommended'],
    {
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: {
          project: projects,
          tsconfigRootDir,
        },
      },
    },
    {
      // 'error': existing JSX-text hardcodes were migrated to useTranslations() /
      // @bimdossier/i18n, so any NEW literal JSX text fails CI. Default 'jsx-text-only'
      // mode guards JSX text, not attributes; default words.exclude skips
      // punctuation/all-caps/html-entities/emoji (brand wordmarks like {'BimDossier'}).
      rules: {
        'i18next/no-literal-string': [
          'error',
          {
            message:
              'String literals in JSX must be routed through useTranslations() or @bimdossier/i18n shared catalog.',
          },
        ],
      },
    },
    {
      rules: {
        // TypeScript already resolves identifiers; no-undef on TS is a false-positive
        // generator (window/document) and is the typescript-eslint-recommended off.
        'no-undef': 'off',

        // ── Type-safety floor, re-asserted on top of recommendedTypeChecked so the
        //    tier move can never silently weaken it. This IS the "not lesser" guarantee. ──
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
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
        '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],

        // ── Team conventions worth keeping (the few good airbnb rules, kept individually
        //    so they survive dropping airbnb-base). Not formatting. ──
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-param-reassign': ['error', { props: true }],
        camelcase: ['error', { properties: 'never' }],
        // Visible signal without gating CI — console is often intentional.
        'no-console': ['warn', { allow: ['warn', 'error'] }],

        // ── React ergonomics ──
        'react/react-in-jsx-scope': 'off',
        'react/jsx-filename-extension': ['error', { extensions: ['.tsx'] }],
        'react/jsx-props-no-spreading': 'off',
      },
    },
    ...(forbidElements
      ? [
          {
            rules: {
              'react/forbid-elements': [
                'error',
                {
                  forbid: [
                    {
                      element: 'select',
                      message:
                        'Raw <select> is banned. Use the shared <Select> from @bimdossier/ui so the dropdown chevron is applied automatically.',
                    },
                    {
                      element: 'textarea',
                      message:
                        'Raw <textarea> is banned. Use the shared <Textarea> from @bimdossier/ui.',
                    },
                  ],
                },
              ],
            },
          },
        ]
      : []),
    {
      // Tests legitimately wrangle untyped fixtures.
      files: TEST_FILES,
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        'i18next/no-literal-string': 'off',
        // Test mocks render raw <select>; the forbid guard is app-UI only.
        ...(forbidElements ? { 'react/forbid-elements': 'off' } : {}),
      },
    },
    ...(i18nAllowFiles.length
      ? [{ files: i18nAllowFiles, rules: { 'i18next/no-literal-string': 'off' } }]
      : []),
    // Prettier LAST: turns off every stylistic ESLint rule so the two never fight.
    eslintConfigPrettier,
  );
}
