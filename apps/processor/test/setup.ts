/**
 * Vitest global setup. config.ts no longer ships dev-default credentials (a
 * missing value fails closed in production), so the test process must supply
 * them — mirrors the role of apps/api/tests/conftest.py. Individual tests still
 * override PROCESSOR_SHARED_SECRET as needed; `??=` only fills the gaps.
 */
process.env.NODE_ENV ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'bimstitch';
process.env.S3_SECRET_ACCESS_KEY ??= 'bimstitch-secret';
process.env.PROCESSOR_SHARED_SECRET ??= 'dev-shared-secret-change-me';
