import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { enqueueJob, getQueueStats, removeQueuedJob } from '../queue/queue.js';

/**
 * Constant-time bearer-token check. A plain `auth !== expected` leaks timing on
 * the common-prefix case; `timingSafeEqual` does not. Lengths are compared
 * first because `timingSafeEqual` throws on unequal-length buffers — a length
 * mismatch is already a non-match, so short-circuiting it is safe.
 */
function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Generic job envelope. Type-specific fields live inside `payload` —
 * dispatched by `job_type` in the worker. This keeps the HTTP surface
 * stable across new job types (PDF generation, future imports/exports).
 */
const JobBody = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(['ifc_extraction', 'pdf_extraction', 'pdf_pages_rasterization', 'dxf_extraction', 'image_metadata_extraction', 'compliance_report', 'assurance_plan_report', 'completion_declaration_report', 'dossier_report', 'snag_list_report', 'send_email']),
  // Schema-per-tenant routing key — the worker echoes it back in callbacks
  // so the API can resolve which `org_<hex>` schema to write to.
  organization_id: z.string().uuid(),
  payload: z.record(z.unknown()),
});

export function registerRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true }));

  // Live BullMQ queue depth for the admin processor dashboard. The API proxies
  // this (superuser-only) so the shared secret never reaches the browser.
  app.get('/admin/queue-stats', async (request, reply) => {
    const cfg = getConfig();
    const auth = request.headers.authorization;
    if (!isAuthorized(auth, cfg.PROCESSOR_SHARED_SECRET)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    const counts = await getQueueStats();
    return reply.code(200).send(counts);
  });

  app.post('/jobs', async (request, reply) => {
    const cfg = getConfig();
    const auth = request.headers.authorization;
    if (!isAuthorized(auth, cfg.PROCESSOR_SHARED_SECRET)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const parsed = JobBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        issues: parsed.error.issues,
      });
    }

    await enqueueJob(parsed.data);
    return reply.code(202).send({ accepted: true });
  });

  // Cancel a still-queued job by id. The API calls this before flipping the
  // Job to `cancelled`; an already-running job returns 409 so the API leaves
  // it to finish via the worker's own terminal callback.
  app.post('/jobs/:jobId/cancel', async (request, reply) => {
    const cfg = getConfig();
    const auth = request.headers.authorization;
    if (!isAuthorized(auth, cfg.PROCESSOR_SHARED_SECRET)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { jobId } = request.params as { jobId: string };
    const result = await removeQueuedJob(jobId);
    if (result === 'active') {
      return reply.code(409).send({ error: 'ALREADY_RUNNING' });
    }
    // `removed` and `not_found` both resolve to success — cancel is
    // best-effort and idempotent (a missing job is already gone).
    return reply.code(200).send({ result });
  });
}
