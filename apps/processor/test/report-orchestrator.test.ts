/**
 * Tests for `runComplianceReport` — the orchestrator that ties together
 * payload validation, HTML rendering, Puppeteer (mocked), S3 upload (mocked),
 * and the API callback.
 *
 * No real Chromium / Redis / S3 / API needed: every external is mocked via
 * vi.mock, so this runs in CI without infrastructure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callbackMock = vi.fn();
const uploadMock = vi.fn();
const htmlToPdfMock = vi.fn();

vi.mock('../src/pipeline/report/callback.js', () => ({
  postReportCallback: (...args: unknown[]) => callbackMock(...args),
}));
vi.mock('../src/storage/s3.js', () => ({
  uploadObject: (...args: unknown[]) => uploadMock(...args),
}));
vi.mock('../src/pipeline/report/pdf.js', () => ({
  htmlToPdf: (...args: unknown[]) => htmlToPdfMock(...args),
}));

const VALID_PAYLOAD = {
  report_id: '11111111-1111-1111-1111-111111111111',
  storage_key: 'reports/org-1/proj-1/report-1.pdf',
  generated_at: '2026-05-12T10:00:00Z',
  locale: 'nl',
  project: {
    id: 'proj-1',
    name: 'Test Project',
  },
  compliance: { framework: 'bbl', total_rules: 1 },
};

beforeEach(() => {
  callbackMock.mockReset().mockResolvedValue(undefined);
  uploadMock.mockReset().mockResolvedValue(undefined);
  htmlToPdfMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('runComplianceReport', () => {
  it('posts running → ready callbacks on the happy path with sha256 + byte_size', async () => {
    htmlToPdfMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // "%PDF" stub
    const { runComplianceReport } = await import('../src/pipeline/report/index.js');

    await runComplianceReport({
      job_id: 'job-1',
      job_type: 'compliance_report',
      payload: VALID_PAYLOAD as unknown as Record<string, unknown>,
    });

    // Two callbacks: one running, one ready.
    expect(callbackMock).toHaveBeenCalledTimes(2);
    const [running, ready] = callbackMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(running.status).toBe('running');
    expect(running.report_id).toBe(VALID_PAYLOAD.report_id);
    expect(running.job_id).toBe('job-1');
    expect(running.started_at).toBeDefined();

    expect(ready.status).toBe('ready');
    expect(ready.storage_key).toBe(VALID_PAYLOAD.storage_key);
    expect(ready.byte_size).toBe(4);
    // sha256 of "%PDF" = c8a3..., we just assert shape.
    expect(typeof ready.sha256).toBe('string');
    expect((ready.sha256 as string).length).toBe(64);
    expect(ready.finished_at).toBeDefined();

    // The PDF actually got uploaded with the right key.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      VALID_PAYLOAD.storage_key,
      expect.any(Buffer),
      'application/pdf',
    );
  });

  it('passes the payload through to renderHtml (HTML reaches Puppeteer)', async () => {
    htmlToPdfMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const { runComplianceReport } = await import('../src/pipeline/report/index.js');

    await runComplianceReport({
      job_id: 'job-2',
      job_type: 'compliance_report',
      payload: VALID_PAYLOAD as unknown as Record<string, unknown>,
    });

    // First arg is the rendered HTML string; second is { generatedAt }.
    expect(htmlToPdfMock).toHaveBeenCalledTimes(1);
    const [html, opts] = htmlToPdfMock.mock.calls[0] as [string, { generatedAt: string }];
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Test Project');
    expect(opts.generatedAt).toBe(VALID_PAYLOAD.generated_at);
  });

  it('posts a failed callback and rethrows when the renderer throws', async () => {
    htmlToPdfMock.mockRejectedValue(new Error('CHROMIUM_OOM'));
    const { runComplianceReport } = await import('../src/pipeline/report/index.js');

    await expect(
      runComplianceReport({
        job_id: 'job-3',
        job_type: 'compliance_report',
        payload: VALID_PAYLOAD as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow('CHROMIUM_OOM');

    // Two callbacks: running, then failed.
    expect(callbackMock).toHaveBeenCalledTimes(2);
    const failed = callbackMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(failed.status).toBe('failed');
    expect(failed.report_id).toBe(VALID_PAYLOAD.report_id);
    expect(typeof failed.error).toBe('string');
    expect((failed.error as string).includes('CHROMIUM_OOM')).toBe(true);

    // Upload should not have happened — render failed before any S3 call.
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('posts a failed callback and throws on invalid payload (no Chromium called)', async () => {
    const { runComplianceReport } = await import('../src/pipeline/report/index.js');

    await expect(
      runComplianceReport({
        job_id: 'job-4',
        job_type: 'compliance_report',
        // Missing required fields: storage_key, generated_at, locale, project.
        payload: { report_id: 'whatever' } as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(/INVALID_REPORT_PAYLOAD/);

    expect(htmlToPdfMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();

    // Single failed callback emitted, not the running→failed pair (we never
    // got far enough to send the running one).
    expect(callbackMock).toHaveBeenCalledTimes(1);
    const failed = callbackMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(failed.status).toBe('failed');
    expect((failed.error as string).startsWith('INVALID_REPORT_PAYLOAD')).toBe(true);
  });
});
