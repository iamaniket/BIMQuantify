/**
 * Entry point: starts a Fastify server on PORT and a BullMQ worker on the
 * configured Redis. The HTTP server is the producer (POST /jobs); the worker
 * is the consumer.
 *
 * Both run in the same process for v1 — split into separate web/worker
 * deployments if/when concurrency or restart semantics demand it.
 */

import { getConfig } from './config.js';
import { closeEmailTransport } from './email/transport.js';
import { buildServer } from './http/server.js';
import { logger } from './log.js';
import { closeBrowser } from './pipeline/report/chromium.js';
import { startActionWorker } from './queue/action-worker.js';
import { closeQueue } from './queue/queue.js';
import { startWorker } from './queue/worker.js';
import { captureException, flushSentry, initSentry } from './sentry.js';

async function main(): Promise<void> {
  initSentry();
  const cfg = getConfig();
  const server = await buildServer();
  const worker = startWorker();
  const actionWorker = startActionWorker();

  await server.listen({ host: '0.0.0.0', port: cfg.PORT });
  logger.info({ port: cfg.PORT }, 'processor service listening');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await server.close();
      await actionWorker.close();
      await worker.close();
      await closeQueue();
      await closeBrowser();
      closeEmailTransport();
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

  // The worker is unattended — a crash here would otherwise vanish into stdout.
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
    captureException(reason, { kind: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err: unknown) => {
    logger.error({ err }, 'uncaught exception');
    captureException(err, { kind: 'uncaughtException' });
    void flushSentry().finally(() => process.exit(1));
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal startup error');
  captureException(err, { kind: 'startup' });
  void flushSentry().finally(() => process.exit(1));
});
