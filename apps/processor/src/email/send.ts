/**
 * send_email action handler. Validates the payload, renders the branded
 * HTML template, and delivers via the configured transport.
 *
 * No callback to the API — BullMQ handles retry on failure.
 */

import { z } from 'zod';

import { logger } from '../log.js';
import type { WorkerJob } from '../queue/queue.js';

import { renderEmailHtml } from './template.js';
import { deliverEmail } from './transport.js';

const SendEmailPayload = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  action_url: z.string().url().optional(),
  action_label: z.string().optional(),
  type: z.enum(['reminder', 'alert', 'info']).optional(),
});

export async function runSendEmail(job: WorkerJob): Promise<void> {
  const parsed = SendEmailPayload.safeParse(job.payload);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues, jobId: job.job_id }, 'invalid send_email payload');
    throw new Error(`invalid send_email payload: ${parsed.error.message}`);
  }

  const { to, subject, body, action_url, action_label, type } = parsed.data;
  const html = renderEmailHtml({ subject, body, action_url, action_label, type });

  await deliverEmail({ to, subject, text: body, html });
}
