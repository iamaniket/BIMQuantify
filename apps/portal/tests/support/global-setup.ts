/**
 * Playwright global setup — creates an isolated E2E database, starts the API
 * server pointing at it, and waits for it to become healthy.
 *
 * All service URLs are configurable via E2E_* env vars so the same setup works
 * with both dev containers (default) and the dedicated test compose.
 *
 * The dev API must NOT be running on port 8000 when E2E tests start.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import type { FullConfig } from '@playwright/test';

import { PID_FILE, SETUP_LOCK, killProcessOnPort } from './e2eApiProcess';

const API_DIR = resolve(__dirname, '../../../api');
const REPO_ROOT = resolve(__dirname, '../../../..');

// All configurable — run-e2e.mjs overrides these for test containers.
const DB_URL = process.env['E2E_DATABASE_URL']
  ?? 'postgresql+asyncpg://bim:bim@localhost:5434/bimstitch_e2e';
const REDIS_URL = process.env['E2E_REDIS_URL']
  ?? 'redis://localhost:6380/2';
const MAILHOG_URL = process.env['E2E_MAILHOG_URL']
  ?? 'http://localhost:8025';
const SMTP_PORT = process.env['E2E_SMTP_PORT'] ?? '1025';
const S3_ENDPOINT = process.env['E2E_S3_ENDPOINT']
  ?? 'http://localhost:9000';
const REDIS_CONTAINER = process.env['E2E_REDIS_CONTAINER']
  ?? 'bimstitch-redis';
const REDIS_DB = process.env['E2E_REDIS_DB'] ?? '2';
const API_PORT = process.env['E2E_API_PORT'] ?? '8000';

const API_URL = `http://localhost:${API_PORT}`;

async function isApiHealthy(timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isApiHealthy()) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`API did not become healthy within ${timeoutMs / 1000}s`);
}

/** Like waitForHealth but returns false instead of throwing on timeout. */
async function waitForHealthBool(timeoutMs: number): Promise<boolean> {
  return waitForHealth(timeoutMs).then(() => true).catch(() => false);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. Reuse-aware, concurrency-safe guard.
  //
  // Playwright runs globalSetup more than once per `playwright test --ui`
  // session — sometimes *concurrently* at startup. The original code
  // unconditionally dropped + recreated the E2E database AND spawned a fresh
  // API on the same port on every call, so a later invocation could reset the
  // database out from under the API an earlier one had already started: the
  // surviving API's pool pointed at a recreated DB, authenticated requests
  // 500'd, and the portal silently redirected to /login. That is the "--ui mode
  // hangs on the first test / nothing passes" symptom (tests then wait the full
  // per-test timeout for an element that never appears).
  //
  // Fix: exactly one invocation does the real DB reset + API spawn; the rest
  // reuse that API (like webServer's reuseExistingServer).

  // Fast path: a healthy API we started is already up — reuse it untouched.
  if ((await isApiHealthy()) && existsSync(PID_FILE)) {
    console.log('[E2E Setup] Reusing the running E2E API (--ui re-entry) — skipping DB reset.');
    return;
  }

  // Serialize concurrent invocations: whoever creates the lock first (atomic
  // `wx` write) owns setup; the rest wait for the owner's API and reuse it.
  let owner = false;
  try {
    writeFileSync(SETUP_LOCK, String(process.pid), { flag: 'wx' });
    owner = true;
  } catch {
    owner = false;
  }

  if (!owner) {
    // Another invocation is setting up (or a stale lock remains). Wait for the
    // API to come up and reuse it.
    if (await waitForHealthBool(90_000)) {
      console.log('[E2E Setup] Reusing the E2E API set up by a concurrent invocation.');
      return;
    }
    // Lock is stale (owner crashed/force-closed) — reclaim and take over.
    console.log('[E2E Setup] Stale setup lock and no healthy API — taking over.');
    killProcessOnPort(API_PORT);
    for (const f of [PID_FILE, SETUP_LOCK]) {
      try { unlinkSync(f); } catch { /* already gone */ }
    }
    try {
      writeFileSync(SETUP_LOCK, String(process.pid), { flag: 'wx' });
    } catch {
      // Lost the takeover race to yet another invocation — wait for its API.
      if (await waitForHealthBool(90_000)) return;
    }
  }

  // Owner path. A foreign (dev) API on the port is a hard stop — never reset or
  // test against the dev database.
  if ((await isApiHealthy()) && !existsSync(PID_FILE)) {
    try { unlinkSync(SETUP_LOCK); } catch { /* ignore */ }
    throw new Error(
      `Port ${API_PORT} is already in use (dev API running?).\n`
        + 'Stop your dev API before running E2E tests.',
    );
  }

  // A stale PID file with nothing healthy means a previous session wasn't torn
  // down — reap any orphan holding the port before starting fresh.
  if (existsSync(PID_FILE)) {
    console.log('[E2E Setup] Stale PID file (previous session not torn down) — reclaiming port.');
    killProcessOnPort(API_PORT);
    try { unlinkSync(PID_FILE); } catch { /* already gone */ }
  }

  // 2. Create E2E database, run migrations, seed
  console.log('[E2E Setup] Creating E2E database...');
  execSync('uv run python scripts/setup_e2e_db.py', {
    cwd: API_DIR,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: DB_URL },
  });

  // 3. Start API server against the E2E database
  console.log(`[E2E Setup] Starting API server on port ${API_PORT}...`);
  const apiProcess = spawn(
    'uv',
    ['run', 'uvicorn', 'bimstitch_api.main:app', '--port', API_PORT],
    {
      cwd: API_DIR,
      env: {
        ...process.env,
        DATABASE_URL: DB_URL,
        REDIS_URL,
        SMTP_PORT,
        S3_ENDPOINT_URL: S3_ENDPOINT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    },
  );

  apiProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[API] ${d}`));
  apiProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[API] ${d}`));

  writeFileSync(PID_FILE, String(apiProcess.pid));

  // 4. Wait for API health
  await waitForHealth();
  console.log('[E2E Setup] API is healthy.');

  // 5. Flush E2E Redis and clear MailHog
  const dbFlag = REDIS_DB === '0' ? '' : `-n ${REDIS_DB}`;
  try {
    execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${dbFlag} FLUSHDB`, { stdio: 'ignore' });
  } catch {
    console.warn('[E2E Setup] Warning: could not flush Redis');
  }
  try {
    await fetch(`${MAILHOG_URL}/api/v1/messages`, { method: 'DELETE' });
  } catch {
    console.warn('[E2E Setup] Warning: could not clear MailHog');
  }

  console.log('[E2E Setup] Ready.');
}
