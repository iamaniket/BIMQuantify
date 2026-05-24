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
import { writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import type { FullConfig } from '@playwright/test';

const PID_FILE = join(tmpdir(), 'bimstitch-e2e-api.pid');
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

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`API did not become healthy within ${timeoutMs / 1000}s`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // 1. Port guard — abort if something is already on the API port
  try {
    const res = await fetch(`${API_URL}/health`);
    if (res.ok) {
      throw new Error(
        `Port ${API_PORT} is already in use (dev API running?).\n`
          + 'Stop your dev API before running E2E tests.',
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already in use')) throw err;
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
