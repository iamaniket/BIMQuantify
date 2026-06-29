/**
 * Guards the per-job callback ROUTING that free-tier extraction depends on:
 *   - `payload.callback_path` (threaded via runWithCallbackUrl) overrides the
 *     default tenant path → free jobs hit /internal/jobs/free-callback.
 *   - `callback_url` (the per-job envelope value) overrides the baked
 *     API_BASE_URL → the worker calls back to the dispatching API instance.
 *
 * This is the seam that broke free extraction (free callbacks silently landing
 * on the tenant endpoint / an unreachable base). API-side tests stub the
 * dispatcher and never exercise it, so it lives here. Mocks global fetch — no
 * live API needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postCallback, type CallbackPayload } from '../src/api/callback.js';
import { runWithCallbackUrl } from '../src/api/callbackContext.js';
import { resetConfig } from '../src/config.js';

const SECRET = 'test-secret-for-callback';
const BAKED_BASE = 'http://baked-api.test:8000';
const FREE_PATH = '/internal/jobs/free-callback';
const TENANT_PATH = '/internal/jobs/callback';

const PAYLOAD: CallbackPayload = {
  file_id: 'f1',
  organization_id: '00000000-0000-0000-0000-000000000000',
  status: 'succeeded',
};

beforeEach(() => {
  process.env.PROCESSOR_SHARED_SECRET = SECRET;
  process.env.API_BASE_URL = BAKED_BASE;
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
}

function calledUrl(fetchMock: ReturnType<typeof mockFetch>): string {
  const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
  return url;
}

describe('postCallback routing', () => {
  it('defaults to the tenant callback path with no per-job override', async () => {
    const fetchMock = mockFetch();
    await postCallback(PAYLOAD);
    expect(calledUrl(fetchMock)).toBe(`${BAKED_BASE}${TENANT_PATH}`);
  });

  it('routes to the free callback path when callback_path is set', async () => {
    const fetchMock = mockFetch();
    await runWithCallbackUrl(undefined, FREE_PATH, () => postCallback(PAYLOAD));
    expect(calledUrl(fetchMock)).toBe(`${BAKED_BASE}${FREE_PATH}`);
  });

  it('uses the per-job callback_url over the baked API_BASE_URL', async () => {
    const fetchMock = mockFetch();
    const perJobBase = 'http://dispatching-api.test:9000';
    await runWithCallbackUrl(perJobBase, undefined, () => postCallback(PAYLOAD));
    expect(calledUrl(fetchMock)).toBe(`${perJobBase}${TENANT_PATH}`);
  });

  it('combines per-job callback_url + free callback_path (the free-tier case)', async () => {
    const fetchMock = mockFetch();
    const perJobBase = 'http://host.docker.internal:8000';
    await runWithCallbackUrl(perJobBase, FREE_PATH, () => postCallback(PAYLOAD));
    expect(calledUrl(fetchMock)).toBe(`${perJobBase}${FREE_PATH}`);
  });

  it('strips a trailing slash on the per-job callback_url', async () => {
    const fetchMock = mockFetch();
    await runWithCallbackUrl('http://host.docker.internal:8000/', FREE_PATH, () =>
      postCallback(PAYLOAD),
    );
    expect(calledUrl(fetchMock)).toBe(`http://host.docker.internal:8000${FREE_PATH}`);
  });

  it('sends bearer auth so the free callback passes require_worker_secret', async () => {
    const fetchMock = mockFetch();
    await runWithCallbackUrl(undefined, FREE_PATH, () => postCallback(PAYLOAD));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${SECRET}`);
  });
});
