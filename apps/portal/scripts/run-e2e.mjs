/**
 * One-command E2E test runner with isolated test containers.
 *
 * Spins up docker-compose.test.yml (Postgres 5435, Redis 6381, MailHog 8026,
 * MinIO 9002), runs Playwright E2E tests against them, and tears everything
 * down — even on failure.
 *
 * Usage:
 *   pnpm test:e2e:full           # multitenant suite
 *   node scripts/run-e2e.mjs     # same thing
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { argv } from 'process';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PORTAL_DIR = resolve(REPO_ROOT, 'apps', 'portal');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.test.yml');

const E2E_ENV = {
  E2E_DATABASE_URL: 'postgresql+asyncpg://bim:bim@localhost:5435/bimstitch_e2e',
  E2E_REDIS_URL: 'redis://localhost:6381/0',
  E2E_MAILHOG_URL: 'http://localhost:8026',
  E2E_SMTP_PORT: '1026',
  E2E_S3_ENDPOINT: 'http://localhost:9002',
  E2E_REDIS_CONTAINER: 'bimstitch-test-redis',
  E2E_REDIS_DB: '0',
};

// Allow passing extra playwright args, e.g.: node scripts/run-e2e.mjs --ui
const extraArgs = argv.slice(2).join(' ');
const testCmd = extraArgs
  ? `npx playwright test ${extraArgs}`
  : 'npx playwright test tests/e2e/multitenant.spec.ts --project=chromium --workers=1';

let exitCode = 0;

try {
  console.log('[run-e2e] Starting test containers...');
  execSync(`docker compose -f "${COMPOSE_FILE}" up -d --wait`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  console.log('[run-e2e] Running E2E tests...\n');
  execSync(testCmd, {
    cwd: PORTAL_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...E2E_ENV },
  });
} catch (err) {
  exitCode = err.status ?? 1;
} finally {
  console.log('\n[run-e2e] Tearing down test containers...');
  try {
    execSync(`docker compose -f "${COMPOSE_FILE}" down -v`, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  } catch {
    console.error('[run-e2e] Warning: docker compose down failed');
  }
}

process.exit(exitCode);
