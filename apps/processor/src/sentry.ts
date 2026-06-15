/**
 * Sentry initialisation for the processor worker.
 *
 * Idempotent and env-gated: a missing `SENTRY_DSN` turns the SDK into a no-op
 * without raising — mirroring `apps/api/.../observability.py` and the portal's
 * `sentry.server.config.ts`. The processor is the one *unattended* service
 * (background IFC/PDF/report jobs), so an unhandled crash or a terminal job
 * failure should reach Sentry, not just pino stdout. Env-var names match the
 * rest of the repo: SENTRY_DSN / SENTRY_ENVIRONMENT / SENTRY_RELEASE /
 * SENTRY_TRACES_SAMPLE_RATE.
 */

import * as Sentry from '@sentry/node';

function resolveRelease(): string | undefined {
  const candidates = [
    process.env['SENTRY_RELEASE'],
    process.env['VERCEL_GIT_COMMIT_SHA'],
    process.env['GITHUB_SHA'],
    process.env['GIT_SHA'],
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.trim() !== '') return candidate;
  }
  return undefined;
}

let initialised = false;

/** Initialise Sentry when SENTRY_DSN is set. Returns true when active. */
export function initSentry(): boolean {
  if (initialised) return true;
  const dsn = process.env['SENTRY_DSN'];
  if (dsn === undefined || dsn.trim() === '') return false;
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    release: resolveRelease(),
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
  });
  initialised = true;
  return true;
}

/** Report an exception to Sentry. No-op when Sentry isn't initialised. */
export function captureException(
  error: unknown,
  tags?: Record<string, string | undefined>,
): void {
  if (tags === undefined) {
    Sentry.captureException(error);
  } else {
    Sentry.captureException(error, { tags });
  }
}

/** Best-effort flush of buffered events before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialised) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutting down anyway — nothing useful to do with a flush error.
  }
}
