import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

import { getConfig } from '../config.js';
import { registerRoutes } from './routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = getConfig();
  const app = Fastify({
    logger: {
      level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        cfg.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard' },
            },
    },
  });
  await app.register(sensible);
  registerRoutes(app);
  return app;
}
