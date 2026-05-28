import { getConfig } from '../config.js';
import { logger } from '../log.js';

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
};

export async function postAttachmentCallback(payload: AttachmentCallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${cfg.API_BASE_URL.replace(/\/$/, '')}/internal/jobs/attachments/callback`;
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
