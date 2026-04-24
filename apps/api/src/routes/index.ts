import type { FastifyPluginAsync } from 'fastify';
import { parseIfc } from '@bim-quantify/ifc-parser';
import { parseBcf } from '@bim-quantify/bcf-parser';
import { runTakeoff } from '@bim-quantify/ai-takeoff';

export const routes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /health
   * Simple health check endpoint.
   */
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /**
   * POST /ifc/parse
   * Accepts a multipart file upload of an IFC file and returns parsed elements.
   */
  fastify.post('/ifc/parse', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = new Uint8Array(Buffer.concat(chunks));

    try {
      const result = await parseIfc(buffer);
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to parse IFC file' });
    }
  });

  /**
   * POST /bcf/parse
   * Accepts a multipart file upload of a .bcfzip file and returns parsed topics.
   */
  fastify.post('/bcf/parse', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = new Uint8Array(Buffer.concat(chunks));

    try {
      const result = parseBcf(buffer);
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to parse BCF file' });
    }
  });

  /**
   * POST /takeoff
   * Runs AI quantity takeoff on an array of IFC elements.
   * Body: { elements: IfcElement[], projectDescription?: string }
   */
  fastify.post<{
    Body: { elements: unknown[]; projectDescription?: string };
  }>('/takeoff', async (request, reply) => {
    const { elements, projectDescription } = request.body;

    if (!Array.isArray(elements)) {
      return reply.status(400).send({ error: '`elements` must be an array' });
    }

    try {
      const result = await runTakeoff({
        elements: elements as Parameters<typeof runTakeoff>[0]['elements'],
        projectDescription,
      });
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'AI takeoff failed' });
    }
  });
};
