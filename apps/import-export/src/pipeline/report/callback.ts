/**
 * Worker → API callback for report jobs.
 *
 * Distinct from the file-extraction callback (`src/api/callback.ts`)
 * because reports update a Report row, not a ProjectFile. Both endpoints
 * sit under /internal/jobs/* and share the same shared-secret bearer.
 */

import { getConfig } from '../../config.js';
import { logger } from '../../log.js';

export type ReportCallbackStatus = 'running' | 'ready' | 'failed';

export type ReportCallbackPayload = {
  report_id: string;
  job_id: string;
  status: ReportCallbackStatus;
  storage_key?: string;
  byte_size?: number;
  sha256?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
};

export async function postReportCallback(payload: ReportCallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${cfg.API_BASE_URL.replace(/\/$/, '')}/internal/jobs/reports/callback`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.IMPORT_EXPORT_SHARED_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: text.slice(0, 500), payload },
      'report callback to API failed',
    );
    throw new Error(`report callback ${url} returned ${response.status}`);
  }
}
