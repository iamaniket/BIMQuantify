import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import Fastify from 'fastify';
import { routes } from './routes/index.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  });

  await app.register(routes);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
