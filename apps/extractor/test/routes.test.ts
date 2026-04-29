/**
 * HTTP route tests. The queue.add path is monkey-patched to avoid touching
 * Redis — we only assert the route auth + validation behaviour here.
 */

import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueMock = vi.fn();

vi.mock('../src/queue/queue.js', () => ({
  enqueueExtraction: (...args: unknown[]) => enqueueMock(...args),
  getRedis: vi.fn(),
  getQueue: vi.fn(),
  closeQueue: vi.fn(),
}));

const SECRET = 'dev-shared-secret-change-me';

beforeEach(() => {
  enqueueMock.mockReset();
  process.env.EXTRACTOR_SHARED_SECRET = SECRET;
});

afterEach(() => {
  vi.resetModules();
});

async function buildApp() {
  // Import after env + mock setup so module-level config caches the right value.
  const { resetConfig } = await import('../src/config.js');
  resetConfig();
  const { registerRoutes } = await import('../src/http/routes.js');
  const app = Fastify();
  await app.register(sensible);
  registerRoutes(app);
  return app;
}

describe('POST /jobs', () => {
  const validBody = {
    file_id: '123e4567-e89b-12d3-a456-426614174000',
    project_id: '123e4567-e89b-12d3-a456-426614174001',
    storage_key: 'projects/abc/file.ifc',
  };

  it('returns 401 without auth', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: validBody,
    });
    expect(resp.statusCode).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns 401 with wrong secret', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: { authorization: 'Bearer nope' },
      payload: validBody,
    });
    expect(resp.statusCode).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns 400 with malformed body', async () => {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: { authorization: `Bearer ${SECRET}` },
      payload: { file_id: 'not-a-uuid' },
    });
    expect(resp.statusCode).toBe(400);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns 202 and enqueues on a valid request', async () => {
    enqueueMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: { authorization: `Bearer ${SECRET}` },
      payload: validBody,
    });
    expect(resp.statusCode).toBe(202);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(validBody);
  });
});

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const app = await buildApp();
    const resp = await app.inject({ method: 'GET', url: '/healthz' });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ ok: true });
  });
});
