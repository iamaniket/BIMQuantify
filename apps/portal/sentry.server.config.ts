import * as Sentry from '@sentry/nextjs';

const dsn = process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'];

const release =
  process.env['SENTRY_RELEASE']
  ?? process.env['NEXT_PUBLIC_SENTRY_RELEASE']
  ?? process.env['VERCEL_GIT_COMMIT_SHA']
  ?? process.env['GITHUB_SHA']
  ?? process.env['GIT_SHA'];

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment: process.env['SENTRY_ENV'] ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
  });
}
