'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  cancelJob, getJob, listJobs, retryJob,
} from '@/lib/api/jobs';
import {
  isJobActive,
  type Job,
  type JobListResponse,
} from '@/lib/api/schemas/jobs';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { modelsKey } from '../models/queryKeys';
import { notificationsKey, unreadCountKey } from '../notifications/queryKeys';
import { reportsListKey } from '../reports/queryKeys';
import { jobKey, jobsKey } from './queryKeys';

/** Jobs for a project, newest first. Polls every 3s while any job is still
 * in-flight (pending|started|running) so progress and terminal transitions
 * surface without a WebSocket round-trip; stops polling once all settle. */
export function useJobs(projectId: string): UseQueryResult<JobListResponse> {
  return useAuthQuery({
    queryKey: jobsKey(projectId),
    queryFn: (accessToken) => listJobs(accessToken, { projectId }),
    enabled: projectId.length > 0,
    refetchInterval: (query) => {
      const { data } = query.state;
      if (data === undefined) return false;
      return data.items.some((job) => isJobActive(job.status)) ? 3000 : false;
    },
  });
}

/** Single job by id. Used by the notification bell to resolve the live state
 * (status / retriable / progress) behind a notification's `job_id`. Polls
 * every 3s while the job is still in-flight so the progress bar advances and
 * the Retry/Cancel affordances flip without a manual reload. */
export function useJob(
  jobId: string | null,
  enabled = true,
): UseQueryResult<Job> {
  return useAuthQuery({
    queryKey: jobKey(jobId ?? ''),
    queryFn: (accessToken) => {
      if (jobId === null) throw new Error('jobId is null');
      return getJob(accessToken, jobId);
    },
    enabled: jobId !== null && enabled,
    refetchInterval: (query) => {
      const { data } = query.state;
      if (data === undefined) return false;
      return isJobActive(data.status) ? 3000 : false;
    },
  });
}

/** Mint a fresh retry job. Invalidates the jobs list plus the resource lists
 * (model files / reports) and the notification feed so every surface updates. */
export function useRetryJob(
  projectId: string,
): UseMutationResult<Job, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, jobId) => retryJob(accessToken, jobId),
    invalidateKeys: [
      jobsKey(projectId),
      modelsKey(projectId),
      reportsListKey(projectId),
      notificationsKey,
      unreadCountKey,
    ],
  });
}

/** Cancel a still-queued job. Same invalidation fan-out as retry. */
export function useCancelJob(
  projectId: string,
): UseMutationResult<Job, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, jobId) => cancelJob(accessToken, jobId),
    invalidateKeys: [
      jobsKey(projectId),
      modelsKey(projectId),
      reportsListKey(projectId),
      notificationsKey,
      unreadCountKey,
    ],
  });
}
