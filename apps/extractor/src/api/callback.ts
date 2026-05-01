import { getConfig } from '../config.js';
import { logger } from '../log.js';

export type CallbackStatus = 'running' | 'succeeded' | 'failed';

export type CallbackPayload = {
  file_id: string;
  job_id?: string;
  status: CallbackStatus;
  fragments_key?: string;
  metadata_key?: string;
  properties_key?: string;
  page_count?: number;
  error?: string;
  extractor_version?: string;
  started_at?: string;
  finished_at?: string;
};

export async function postCallback(payload: CallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${cfg.API_BASE_URL.replace(/\/$/, '')}/internal/extraction/callback`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.EXTRACTOR_SHARED_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: text.slice(0, 500), payload },
      'callback to API failed',
    );
    throw new Error(`callback ${url} returned ${response.status}`);
  }
}
