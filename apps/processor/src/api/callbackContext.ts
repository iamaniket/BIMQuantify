/**
 * Per-job callback base URL (finding L13).
 *
 * The worker used to call back to a single baked `API_BASE_URL`, so it could
 * only ever talk to one API instance — a hazard for multi-API / blue-green
 * topologies where the job was dispatched by (and its row lives on) a specific
 * instance. The API now stamps each dispatched job with a `callback_url`; the
 * worker runs each job — and its terminal-failure callback — inside
 * `runWithCallbackUrl(job.callback_url, ...)`, and the four callback helpers
 * resolve the active base via `callbackBaseUrl()`.
 *
 * Using `AsyncLocalStorage` (rather than threading the URL through every
 * `post*Callback` call site) keeps the base correct across all the awaited
 * pipeline stages of a job while remaining safe under `JOB_CONCURRENCY > 1`:
 * each concurrently-running job gets its own store. A job dispatched by an old
 * API without the field — or any callback outside a job scope — falls back to
 * the baked `API_BASE_URL`, so the change is backwards-compatible.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { getConfig } from '../config.js';

const storage = new AsyncLocalStorage<string | undefined>();

/** Run `fn` with `callbackUrl` as the active per-job callback base. */
export function runWithCallbackUrl<T>(callbackUrl: string | undefined, fn: () => T): T {
  return storage.run(callbackUrl, fn);
}

/** Resolve the callback base URL (no trailing slash) for the current job. */
export function callbackBaseUrl(): string {
  const base = storage.getStore() ?? getConfig().API_BASE_URL;
  return base.replace(/\/$/, '');
}
