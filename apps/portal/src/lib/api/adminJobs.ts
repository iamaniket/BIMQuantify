import { apiClient } from './client';
import {
  AdminActiveJobsSchema,
  ProcessorQueueStatsSchema,
  type AdminActiveJobs,
  type ProcessorQueueStats,
} from './schemas/adminJobs';

/** Live ongoing + stuck jobs across all orgs (superuser-only). */
export async function getAdminActiveJobs(
  accessToken: string,
  params: { limit?: number } = {},
): Promise<AdminActiveJobs> {
  const query = params.limit === undefined ? '' : `?limit=${params.limit}`;
  return apiClient.get<AdminActiveJobs>(
    `/admin/jobs/active${query}`,
    AdminActiveJobsSchema,
    accessToken,
  );
}

/** Live BullMQ queue depth, proxied from the processor (superuser-only). */
export async function getProcessorQueueStats(
  accessToken: string,
): Promise<ProcessorQueueStats> {
  return apiClient.get<ProcessorQueueStats>(
    '/admin/processor/queue-stats',
    ProcessorQueueStatsSchema,
    accessToken,
  );
}
