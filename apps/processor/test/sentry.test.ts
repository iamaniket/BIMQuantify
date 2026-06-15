/**
 * The processor's Sentry wiring must be a no-op when SENTRY_DSN is unset (dev,
 * tests, any deploy that opts out) and must initialise exactly once when it is
 * set. We mock @sentry/node so the test never touches the network.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const initMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock('@sentry/node', () => ({
  init: initMock,
  captureException: captureExceptionMock,
  flush: vi.fn().mockResolvedValue(true),
}));

describe('processor Sentry init', () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockClear();
    captureExceptionMock.mockClear();
    delete process.env['SENTRY_DSN'];
  });

  it('is a no-op when SENTRY_DSN is unset', async () => {
    const { initSentry } = await import('../src/sentry.js');
    expect(initSentry()).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('initialises exactly once when SENTRY_DSN is set', async () => {
    process.env['SENTRY_DSN'] = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { initSentry } = await import('../src/sentry.js');
    expect(initSentry()).toBe(true);
    expect(initSentry()).toBe(true); // idempotent
    expect(initMock).toHaveBeenCalledTimes(1);
    delete process.env['SENTRY_DSN'];
  });

  it('captureException forwards to the SDK only when given tags', async () => {
    const { captureException } = await import('../src/sentry.js');
    captureException(new Error('boom'));
    captureException(new Error('boom2'), { jobId: 'j1' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenLastCalledWith(expect.any(Error), {
      tags: { jobId: 'j1' },
    });
  });
});
