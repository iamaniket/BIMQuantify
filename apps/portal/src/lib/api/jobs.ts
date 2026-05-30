import { apiClient } from './client';
import {
  JobListResponseSchema,
  JobSchema,
  type Job,
  type JobListResponse,
  type JobStatus,
  type JobType,
} from './schemas/jobs';

type ListJobsParams = Partial<{
  projectId: string;
  status: JobStatus;
  jobType: JobType;
  limit: number;
  offset: number;
}>;

export async function listJobs(
  accessToken: string,
  params: ListJobsParams = {},
): Promise<JobListResponse> {
  const qs = new URLSearchParams();
  if (params.projectId !== undefined) qs.set('project_id', params.projectId);
  if (params.status !== undefined) qs.set('status', params.status);
  if (params.jobType !== undefined) qs.set('job_type', params.jobType);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
  return apiClient.get(`/jobs${suffix}`, JobListResponseSchema, accessToken);
}

export async function getJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.get(`/jobs/${jobId}`, JobSchema, accessToken);
}

export async function retryJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.post(`/jobs/${jobId}/retry`, {}, JobSchema, accessToken);
}

export async function cancelJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.post(`/jobs/${jobId}/cancel`, {}, JobSchema, accessToken);
}
