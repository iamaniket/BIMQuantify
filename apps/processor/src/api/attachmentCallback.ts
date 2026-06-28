import { getConfig } from '../config.js';
import { logger } from '../log.js';
import { callbackBaseUrl } from './callbackContext.js';

export type AttachmentCallbackStatus = 'running' | 'succeeded' | 'failed';

export type AttachmentCallbackPayload = {
  attachment_id: string;
  organization_id: string;
  job_id: string;
  status: AttachmentCallbackStatus;
  server_metadata?: Record<string, unknown>;
  error?: string;
  started_at?: string;
  finished_at?: string;
  // 0-100 progress reported on `running` callbacks.
  progress?: number;
  // Failure classification, set on `failed` callbacks (see pipeline/errors.ts).
  retriable?: boolean;
  error_kind?: string;
};

export async function postAttachmentCallback(payload: AttachmentCallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${callbackBaseUrl()}/internal/jobs/attachments/callback`;
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
      'attachment callback to API failed',
    );
    throw new Error(`attachment callback ${url} returned ${response.status}`);
  }
}
