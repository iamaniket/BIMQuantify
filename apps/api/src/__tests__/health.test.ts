import Fastify from 'fastify';
import { routes } from '../routes/index.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(routes);
  return app;
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('ok');
    await app.close();
  });
});
