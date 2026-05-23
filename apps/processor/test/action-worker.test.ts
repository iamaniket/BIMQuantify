/**
 * Tests for the action queue routing: send_email jobs go to the "actions"
 * queue, not the "jobs" queue.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const jobsAddMock = vi.fn().mockResolvedValue(undefined);
const actionsAddMock = vi.fn().mockResolvedValue(undefined);

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn((name: string) => ({
    name,
    add: name === 'actions' ? actionsAddMock : jobsAddMock,
    close: vi.fn(),
  })),
  Worker: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    REDIS_URL: 'redis://localhost:6380/1',
    ACTION_CONCURRENCY: 10,
    JOB_CONCURRENCY: 2,
    JOB_TIMEOUT_MS: 600_000,
  }),
  QUEUE_NAME: 'jobs',
  ACTION_QUEUE_NAME: 'actions',
}));

describe('enqueueJob routing', () => {
  beforeEach(() => {
    jobsAddMock.mockClear();
    actionsAddMock.mockClear();
  });

  it('routes send_email to the actions queue', async () => {
    const { enqueueJob } = await import('../src/queue/queue.js');
    await enqueueJob({
      job_id: 'aaa-bbb',
      job_type: 'send_email',
      organization_id: '00000000-0000-0000-0000-000000000000',
      payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
    });

    expect(actionsAddMock).toHaveBeenCalledTimes(1);
    expect(jobsAddMock).not.toHaveBeenCalled();
  });

  it('routes ifc_extraction to the jobs queue', async () => {
    const { enqueueJob } = await import('../src/queue/queue.js');
    await enqueueJob({
      job_id: 'ccc-ddd',
      job_type: 'ifc_extraction',
      organization_id: '00000000-0000-0000-0000-000000000000',
      payload: { file_id: 'f1', storage_key: 'test.ifc' },
    });

    expect(jobsAddMock).toHaveBeenCalledTimes(1);
    expect(actionsAddMock).not.toHaveBeenCalled();
  });
});
