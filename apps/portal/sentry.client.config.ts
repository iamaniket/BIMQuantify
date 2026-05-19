import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

// Release pinned at build time so a 'release: foo' tag on the event matches
// the source-map upload that next.config.mjs sent under the same name.
const release =
  process.env['NEXT_PUBLIC_SENTRY_RELEASE']
  ?? process.env['SENTRY_RELEASE']
  ?? process.env['VERCEL_GIT_COMMIT_SHA']
  ?? process.env['GITHUB_SHA']
  ?? process.env['GIT_SHA'];

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment: process.env['NEXT_PUBLIC_SENTRY_ENV'] ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
