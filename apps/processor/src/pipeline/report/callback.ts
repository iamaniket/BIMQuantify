/**
 * Worker → API callback for report jobs.
 *
 * Distinct from the file-extraction callback (`src/api/callback.ts`)
 * because reports update a Report row, not a ProjectFile. Both endpoints
 * sit under /internal/jobs/* and share the same shared-secret bearer.
 */

import { callbackBaseUrl } from '../../api/callbackContext.js';
import { getConfig } from '../../config.js';
import { logger } from '../../log.js';

export type ReportCallbackStatus = 'running' | 'ready' | 'failed';

export type ReportCallbackPayload = {
  report_id: string;
  // Schema-per-tenant routing key. The worker receives it on the dispatch
  // envelope from the API and echoes it back so the API can resolve the
  // tenant schema for the write.
  organization_id: string;
  job_id: string;
  status: ReportCallbackStatus;
  storage_key?: string;
  byte_size?: number;
  sha256?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
  // 0-100 progress reported on `running` callbacks.
  progress?: number;
  // Failure classification, set on `failed` callbacks (see pipeline/errors.ts).
  retriable?: boolean;
  error_kind?: string;
};

export async function postReportCallback(payload: ReportCallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${callbackBaseUrl()}/internal/jobs/reports/callback`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.PROCESSOR_SHARED_SECRET}`,
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
