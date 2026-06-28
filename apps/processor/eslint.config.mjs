/**
 * Standalone ESLint flat config for the processor worker.
 *
 * Deliberately self-contained (NO @bimdossier/* import): the processor is decoupled
 * (npm + its own package-lock.json, built independently in Docker), so it must not take
 * a workspace dependency — that would break `npm ci` in the Dockerfile. Mirrors the
 * shared node-service posture: non-type-aware (syntactic correctness), Prettier owns
 * formatting (eslint:recommended + tseslint recommended carry no formatting rules to
 * conflict with).
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.turbo/**', 'eslint.config.mjs', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
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
      'no-param-reassign': ['error'],
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
);
