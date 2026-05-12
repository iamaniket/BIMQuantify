/**
 * Tests for the report-callback HTTP shape (URL, auth header, body).
 * Mocks global fetch so no live API is needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfig } from '../src/config.js';

const SECRET = 'test-secret-for-callback';
const BASE_URL = 'http://api.test:8000';

beforeEach(() => {
  process.env.IMPORT_EXPORT_SHARED_SECRET = SECRET;
  process.env.API_BASE_URL = BASE_URL;
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('postReportCallback', () => {
  it('POSTs to /internal/jobs/reports/callback with bearer auth and JSON body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const { postReportCallback } = await import('../src/pipeline/report/callback.js');
    await postReportCallback({
      report_id: 'r1',
      job_id: 'j1',
      status: 'ready',
      storage_key: 'reports/o/p/r1.pdf',
      byte_size: 12345,
      sha256: 'a'.repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/internal/jobs/reports/callback`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${SECRET}`);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.report_id).toBe('r1');
    expect(body.job_id).toBe('j1');
    expect(body.status).toBe('ready');
    expect(body.storage_key).toBe('reports/o/p/r1.pdf');
    expect(body.byte_size).toBe(12345);
  });

  it('throws when the API responds non-2xx (worker BullMQ retry catches it)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    const { postReportCallback } = await import('../src/pipeline/report/callback.js');
    await expect(
      postReportCallback({
        report_id: 'r1',
        job_id: 'j1',
        status: 'ready',
        storage_key: 'k',
      }),
    ).rejects.toThrow(/returned 500/);
  });

  it('strips a trailing slash on API_BASE_URL so the URL is well-formed', async () => {
    process.env.API_BASE_URL = `${BASE_URL}/`;
    resetConfig();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const { postReportCallback } = await import('../src/pipeline/report/callback.js');
    await postReportCallback({
      report_id: 'r1',
      job_id: 'j1',
      status: 'running',
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/internal/jobs/reports/callback`);
  });
});
