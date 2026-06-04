/**
 * Playwright global teardown — stops the E2E API server started by global-setup.
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import type { FullConfig } from '@playwright/test';

import { PID_FILE, SETUP_LOCK, killProcessOnPort } from './e2eApiProcess';

const API_PORT = process.env['E2E_API_PORT'] ?? '8010';

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    console.log(`[E2E Teardown] Stopping API server (PID: ${pid})...`);

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Process may have already exited
    }

    try {
      unlinkSync(PID_FILE);
    } catch {
      // File may not exist
    }
  }

  // Belt-and-braces: on Windows the uvicorn child routinely outlives the
  // recorded shell PID, so the taskkill above can miss it.  Killing by port
  // guarantees we don't leave an orphan on :8000 that the next session's port
  // guard would mistake for the dev API.
  killProcessOnPort(API_PORT);

  // Clear the setup mutex so the next session starts a fresh setup.
  try {
    unlinkSync(SETUP_LOCK);
  } catch {
    // File may not exist
  }

  console.log('[E2E Teardown] Done.');
}
