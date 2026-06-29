import { getConfig } from '../config.js';
import { logger } from '../log.js';
import { callbackBaseUrl, callbackPath } from './callbackContext.js';

export type PagesCallbackStatus = 'running' | 'succeeded' | 'failed';

/**
 * Worker → API callback for `pdf_pages_rasterization` jobs. Hits a DEDICATED
 * endpoint (not the extraction callback): the file's extraction_status is
 * already terminal, so this only records the page-image manifest key + the
 * rasterization Job's state.
 */
export type PagesCallbackPayload = {
  file_id: string;
  organization_id: string;
  job_id?: string;
  status: PagesCallbackStatus;
  /** Set on `succeeded`: key of the page-image manifest (pages.json). */
  pdf_pages_key?: string;
  page_count?: number;
  error?: string;
  started_at?: string;
  finished_at?: string;
  /** 0-100 progress on `running` callbacks. */
  progress?: number;
  /** On `failed`: classification (mirrors the extraction callback). */
  retriable?: boolean;
  error_kind?: string;
};

export async function postPagesCallback(payload: PagesCallbackPayload): Promise<void> {
  const cfg = getConfig();
  // Honor the per-job path override (free-tier PDF → /internal/jobs/free-pages-callback);
  // tenant jobs carry no override and fall back to the default pages callback.
  const url = `${callbackBaseUrl()}${callbackPath() ?? '/internal/jobs/pages/callback'}`;
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
      'pages callback to API failed',
    );
    throw new Error(`pages callback ${url} returned ${response.status}`);
  }
}
