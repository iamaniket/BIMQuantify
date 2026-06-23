import { apiClient } from './client';
import {
  JobSchema,
  type Job,
} from './schemas/jobs';

export async function getJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.get(`/jobs/${jobId}`, JobSchema, accessToken);
}

export async function retryJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.post(`/jobs/${jobId}/retry`, {}, JobSchema, accessToken);
}

export async function cancelJob(accessToken: string, jobId: string): Promise<Job> {
  return apiClient.post(`/jobs/${jobId}/cancel`, {}, JobSchema, accessToken);
}
