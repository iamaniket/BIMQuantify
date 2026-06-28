/**
 * Shared ESLint flat config for BimDossier Node.js services (processor).
 *
 * Intentionally NON-type-aware (tseslint `recommended`, not `recommendedTypeChecked`):
 * the processor is decoupled (no @bimdossier/* deps) and was previously not linted at all,
 * so a syntactic config greens its CI gate reliably without per-tsconfig project wiring.
 * Prettier owns formatting (eslint-config-prettier last).
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * @param {object}   [opts]
 * @param {string[]} [opts.extraIgnores] service-specific ignore globs
 */
export function nodeServiceConfig({ extraIgnores = [] } = {}) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.turbo/**',
        'eslint.config.mjs',
        ...extraIgnores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        globals: { ...globals.node },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-expect-error': true,
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': false,
          },
        ],
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-param-reassign': ['error', { props: true }],
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts', 'test/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
      },
    },
    eslintConfigPrettier,
  );
}
