/**
 * Playwright global teardown — stops the E2E API server started by global-setup.
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import type { FullConfig } from '@playwright/test';

const PID_FILE = join(tmpdir(), 'bimstitch-e2e-api.pid');

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  if (!existsSync(PID_FILE)) return;

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

  console.log('[E2E Teardown] Done.');
}
