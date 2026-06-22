/**
 * One-command E2E test runner with isolated test containers.
 *
 * Spins up docker-compose.test.yml (Postgres 5435, Redis 6381, MailHog 8026,
 * MinIO 9002), runs the Playwright E2E suite against them, and tears everything
 * down — even on failure.
 *
 * With no args it runs the ENTIRE suite (every *.spec.ts under tests/), one
 * spec FILE after another, each in its OWN `playwright test` process. That is
 * deliberate: every process runs global-setup (fresh DB reset + a fresh API on
 * :8010) and global-teardown (kills the API, clears the PID/lock), so each spec
 * gets a clean, isolated API. A single `playwright test` over all files instead
 * shares one long-lived API, and under the full suite's sustained load that API
 * gets wedged mid-run — the next spec's health check fails with "API
 * unreachable", and because the big journeys are `test.describe.serial`, one
 * failed step marks the rest "did not run" (a 9-min run where ~120 tests never
 * execute). Per-file isolation is the documented-safe pattern and the only way
 * the whole suite actually runs end to end.
 *
 * Pass args to scope it down — those run as a single passthrough process:
 *   node scripts/run-e2e.mjs tests/e2e/viewer.spec.ts   # one spec
 *   node scripts/run-e2e.mjs --ui                       # interactive UI
 *
 * Usage:
 *   pnpm test:e2e:full           # full suite (per-file, sequential)
 *   node scripts/run-e2e.mjs     # same thing
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { argv } from 'process';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PORTAL_DIR = resolve(REPO_ROOT, 'apps', 'portal');
const TESTS_DIR = resolve(PORTAL_DIR, 'tests');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.test.yml');

const E2E_ENV = {
  E2E_DATABASE_URL: 'postgresql+asyncpg://bim:bim@localhost:5435/bimstitch_e2e',
  E2E_REDIS_URL: 'redis://localhost:6381/0',
  E2E_MAILHOG_URL: 'http://localhost:8026',
  E2E_SMTP_PORT: '1026',
  E2E_S3_ENDPOINT: 'http://localhost:9002',
  E2E_REDIS_CONTAINER: 'bimstitch-test-redis',
  E2E_REDIS_DB: '0',
  // The test processor (docker-compose.test.yml) is published on host 8089.
  // global-setup forwards this as PROCESSOR_URL to the spawned E2E API, so its
  // job/action dispatch (IFC→fragments conversion, deadline-reminder
  // send_email) reaches the test worker — which calls back to the host API on
  // :8010. Without it the viewer + deadline-tracking specs never go green.
  E2E_PROCESSOR_URL: 'http://localhost:8089',
};

/** Every *.spec.ts under tests/, as forward-slash paths relative to PORTAL_DIR. */
function discoverSpecs() {
  return readdirSync(TESTS_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((rel) => rel.endsWith('.spec.ts'))
    .map((rel) => `tests/${rel.split(/[\\/]/).join('/')}`)
    .sort();
}

const runEnv = { ...process.env, ...E2E_ENV };
const runOpts = { cwd: PORTAL_DIR, stdio: 'inherit', env: runEnv };

// Extra args (a spec path, --ui, --headed, …) collapse the run to ONE process,
// which is what scoped/interactive runs want.
const extraArgs = argv.slice(2).join(' ');

let exitCode = 0;

try {
  console.log('[run-e2e] Starting test containers...');
  execSync(`docker compose -f "${COMPOSE_FILE}" up -d --wait`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (extraArgs) {
    console.log(`[run-e2e] Running: playwright test ${extraArgs}\n`);
    execSync(`npx playwright test ${extraArgs}`, runOpts);
  } else {
    const specs = discoverSpecs();
    console.log(`[run-e2e] Running full suite — ${specs.length} spec files, one at a time:`);
    specs.forEach((s) => console.log(`           • ${s}`));

    const results = [];
    for (const spec of specs) {
      console.log(`\n[run-e2e] ===== ${spec} =====`);
      try {
        execSync(`npx playwright test ${spec} --project=chromium --workers=1`, runOpts);
        results.push({ spec, ok: true });
      } catch (err) {
        // Record the failure but keep going — the whole point is to run every
        // spec "one after another", not stop at the first red file.
        results.push({ spec, ok: false, status: err.status ?? 1 });
        exitCode = 1;
      }
    }

    console.log('\n[run-e2e] ===== SUITE SUMMARY =====');
    for (const r of results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.spec}`);
    }
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n[run-e2e] ${results.length - failed.length}/${results.length} spec files passed`
        + (failed.length ? ` — ${failed.length} failed.` : '.'),
    );
  }
} catch (err) {
  // Container startup or the single passthrough run failed.
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
