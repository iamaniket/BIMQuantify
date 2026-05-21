'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import {
  completeInspection,
  getInspectionSummary,
  listResults,
  startInspection,
  submitResult,
} from '@/lib/api/inspection';
import type {
  Borgingsmoment,
  ChecklistItemResult,
  InspectionSummary,
  ResultCreateInput,
} from '@/lib/api/schemas';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { borgingsplanKey } from '../borgingsplan/queryKeys';
import { inspectionKeys } from './queryKeys';

export function useInspectionResults(
  momentId: string,
): UseQueryResult<ChecklistItemResult[]> {
  return useAuthQuery({
    queryKey: inspectionKeys.results(momentId),
    queryFn: (accessToken) => listResults(accessToken, momentId),
  });
}

export function useInspectionSummary(
  momentId: string,
): UseQueryResult<InspectionSummary> {
  return useAuthQuery({
    queryKey: inspectionKeys.summary(momentId),
    queryFn: (accessToken) => getInspectionSummary(accessToken, momentId),
  });
}

export function useStartInspection(
  projectId: string,
  momentId: string,
): UseMutationResult<Borgingsmoment, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => startInspection(accessToken, momentId),
    invalidateKeys: [
      borgingsplanKey(projectId),
      inspectionKeys.results(momentId),
      inspectionKeys.summary(momentId),
    ],
  });
}

type SubmitVars = { itemId: string; input: ResultCreateInput };

export function useSubmitResult(
  momentId: string,
): UseMutationResult<ChecklistItemResult, Error, SubmitVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { itemId, input }) =>
      submitResult(accessToken, momentId, itemId, input),
    invalidateKeys: [
      inspectionKeys.results(momentId),
      inspectionKeys.summary(momentId),
    ],
  });
}

export function useCompleteInspection(
  projectId: string,
  momentId: string,
): UseMutationResult<Borgingsmoment, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => completeInspection(accessToken, momentId),
    invalidateKeys: [
      borgingsplanKey(projectId),
      inspectionKeys.results(momentId),
      inspectionKeys.summary(momentId),
    ],
  });
}
