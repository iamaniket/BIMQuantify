import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { enqueueExtraction } from '../queue/queue.js';

const JobBody = z.object({
  file_id: z.string().uuid(),
  project_id: z.string().uuid(),
  storage_key: z.string().min(1),
  job_id: z.string().uuid().optional(),
  job_type: z.enum(['ifc_extraction', 'pdf_extraction']).default('ifc_extraction'),
});

export function registerRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true }));

  app.post('/jobs', async (request, reply) => {
    const cfg = getConfig();
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${cfg.EXTRACTOR_SHARED_SECRET}`) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const parsed = JobBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        issues: parsed.error.issues,
      });
    }

    await enqueueExtraction(parsed.data);
    return reply.code(202).send({ accepted: true });
  });
}
