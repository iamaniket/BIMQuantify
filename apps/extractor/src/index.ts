/**
 * Entry point: starts a Fastify server on PORT and a BullMQ worker on the
 * configured Redis. The HTTP server is the producer (POST /jobs); the worker
 * is the consumer.
 *
 * Both run in the same process for v1 — split into separate web/worker
 * deployments if/when concurrency or restart semantics demand it.
 */

import { getConfig } from './config.js';
import { buildServer } from './http/server.js';
import { logger } from './log.js';
import { closeQueue } from './queue/queue.js';
import { startWorker } from './queue/worker.js';

async function main(): Promise<void> {
  const cfg = getConfig();
  const server = await buildServer();
  const worker = startWorker();

  await server.listen({ host: '0.0.0.0', port: cfg.PORT });
  logger.info({ port: cfg.PORT }, 'extractor listening');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await server.close();
      await worker.close();
      await closeQueue();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
