/**
 * Shared helpers for the E2E API process that global-setup starts and
 * global-teardown stops.
 *
 * Both files key off the same PID file, and both need a reliable way to free
 * the API port: on Windows `taskkill /T` on the recorded shell PID does not
 * always reach the `uvicorn` child, which then orphans on the port and trips
 * the next session's port guard (it looks like a stray dev API). Killing by
 * port closes that gap.
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

export const PID_FILE = join(tmpdir(), 'bimstitch-e2e-api.pid');

/**
 * Mutex marker for globalSetup. Playwright `--ui` starts globalSetup more than
 * once, sometimes *concurrently*, at session start. Whoever creates this file
 * first (atomic `wx` write) owns the one real DB reset + API spawn; the others
 * wait for that API and reuse it, instead of each racing to drop the database.
 */
export const SETUP_LOCK = join(tmpdir(), 'bimstitch-e2e-setup.lock');

/** Force-kill whatever process is listening on `port` (best effort). */
export function killProcessOnPort(port: string): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf-8' });
      const pids = new Set<string>();
      for (const line of out.split('\n')) {
        // Columns: proto | localAddr | foreignAddr | state | pid
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`)) {
          const pid = cols[4];
          if (pid && pid !== '0') pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // already gone
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} || true`, { encoding: 'utf-8' });
      for (const pid of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  } catch {
    // best effort — never fail teardown/setup over this
  }
}
