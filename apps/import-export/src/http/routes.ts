import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { enqueueJob } from '../queue/queue.js';

/**
 * Generic job envelope. Type-specific fields live inside `payload` —
 * dispatched by `job_type` in the worker. This keeps the HTTP surface
 * stable across new job types (PDF generation, future imports/exports).
 */
const JobBody = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(['ifc_extraction', 'pdf_extraction', 'compliance_report']),
  payload: z.record(z.unknown()),
});

export function registerRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true }));

  app.post('/jobs', async (request, reply) => {
    const cfg = getConfig();
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${cfg.IMPORT_EXPORT_SHARED_SECRET}`) {
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
}
