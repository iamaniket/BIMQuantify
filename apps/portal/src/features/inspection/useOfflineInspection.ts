'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  Borgingsmoment,
  ChecklistItemResult,
  InspectionSummary,
  InspectionVerdictValue,
  ResultCreateInput,
} from '@/lib/api/schemas';
import { getCachedInspection, updateCachedResults } from '@/lib/offline/cache.js';
import { useNetworkStatus } from '@/lib/offline/networkStatus.js';
import { enqueueAction, getEntriesForMoment } from '@/lib/offline/queue.js';
import type { SubmitResultEntry } from '@/lib/offline/types.js';

import {
  useCompleteInspection,
  useInspectionResults,
  useInspectionSummary,
  useStartInspection,
  useSubmitResult,
} from './useInspection.js';

// ---------------------------------------------------------------------------
// Offline results — merges server results with queued local submissions
// ---------------------------------------------------------------------------

export function useOfflineInspectionResults(
  momentId: string,
): UseQueryResult<ChecklistItemResult[]> & { localResults: ChecklistItemResult[] } {
  const { isOnline } = useNetworkStatus();
  const serverQuery = useInspectionResults(momentId);
  const [cachedResults, setCachedResults] = useState<ChecklistItemResult[]>([]);
  const [pendingResults, setPendingResults] = useState<Map<string, SubmitResultEntry>>(new Map());

  useEffect(() => {
    if (!isOnline && serverQuery.data === undefined) {
      void getCachedInspection('', momentId).catch(() => undefined);
    }
  }, [isOnline, serverQuery.data, momentId]);

  useEffect(() => {
    void getEntriesForMoment(momentId).then((entries) => {
      const map = new Map<string, SubmitResultEntry>();
      for (const e of entries) {
        if (e.type === 'submit_result' && e.status !== 'succeeded') {
          map.set(e.payload.itemId, e as SubmitResultEntry);
        }
      }
      setPendingResults(map);
    });
  }, [momentId, serverQuery.data]);

  const mergedResults = useMemo(() => {
    const base = serverQuery.data ?? cachedResults;
    if (pendingResults.size === 0) return base;

    const byItem = new Map<string, ChecklistItemResult>();
    for (const r of base) {
      byItem.set(r.checklist_item_id, r);
    }

    for (const [itemId, entry] of pendingResults) {
      if (!byItem.has(itemId)) {
        byItem.set(itemId, {
          id: `local-${String(entry.id)}`,
          checklist_item_id: itemId,
          borgingsmoment_id: momentId,
          project_id: entry.projectId,
          verdict: entry.payload.input.verdict as InspectionVerdictValue,
          note: entry.payload.input.note ?? null,
          inspector_user_id: 'local',
          inspected_at: new Date(entry.createdAt).toISOString(),
          photo_ids: entry.payload.input.photo_ids ?? null,
          reference_attachment_ids: entry.payload.input.reference_attachment_ids ?? null,
          voice_note_id: null,
          created_at: new Date(entry.createdAt).toISOString(),
          updated_at: new Date(entry.createdAt).toISOString(),
        });
      }
    }

    return Array.from(byItem.values());
  }, [serverQuery.data, cachedResults, pendingResults, momentId]);

  return {
    ...serverQuery,
    data: mergedResults,
    localResults: cachedResults,
  } as UseQueryResult<ChecklistItemResult[]> & { localResults: ChecklistItemResult[] };
}

// ---------------------------------------------------------------------------
// Offline summary — derived from merged results
// ---------------------------------------------------------------------------

export function useOfflineInspectionSummary(
  momentId: string,
  totalItems: number,
  mergedResults: ChecklistItemResult[],
): UseQueryResult<InspectionSummary> {
  const serverQuery = useInspectionSummary(momentId);
  const { isOnline } = useNetworkStatus();

  const localSummary = useMemo((): InspectionSummary => {
    let passed = 0;
    let failed = 0;
    let notApplicable = 0;
    for (const r of mergedResults) {
      if (r.verdict === 'pass') passed++;
      else if (r.verdict === 'fail') failed++;
      else if (r.verdict === 'not_applicable') notApplicable++;
    }
    const completed = passed + failed + notApplicable;
    return {
      total_items: totalItems,
      completed,
      passed,
      failed,
      not_applicable: notApplicable,
      remaining: totalItems - completed,
    };
  }, [mergedResults, totalItems]);

  if (isOnline && serverQuery.data !== undefined) {
    return serverQuery;
  }

  return {
    ...serverQuery,
    data: localSummary,
  } as UseQueryResult<InspectionSummary>;
}

// ---------------------------------------------------------------------------
// Offline submit result
// ---------------------------------------------------------------------------

type SubmitVars = { itemId: string; input: ResultCreateInput };

export function useOfflineSubmitResult(
  projectId: string,
  momentId: string,
): UseMutationResult<ChecklistItemResult, Error, SubmitVars> & { isOfflineSubmit: boolean } {
  const { isOnline } = useNetworkStatus();
  const onlineMutation = useSubmitResult(momentId);
  const [isOfflineSubmit, setIsOfflineSubmit] = useState(false);

  const offlineMutate = useCallback(
    async (vars: SubmitVars): Promise<ChecklistItemResult> => {
      setIsOfflineSubmit(true);

      await enqueueAction({
        type: 'submit_result',
        projectId,
        momentId,
        payload: {
          itemId: vars.itemId,
          input: vars.input,
          tempPhotoIds: vars.input.photo_ids?.filter((id) => id.startsWith('temp-')) ?? undefined,
        },
      });

      void updateCachedResults(projectId, momentId, (prev) => {
        const existing = prev.findIndex((r) => r.checklist_item_id === vars.itemId);
        const localResult: ChecklistItemResult = {
          id: `local-${Date.now().toString(36)}`,
          checklist_item_id: vars.itemId,
          borgingsmoment_id: momentId,
          project_id: projectId,
          verdict: vars.input.verdict as InspectionVerdictValue,
          note: vars.input.note ?? null,
          inspector_user_id: 'local',
          inspected_at: new Date().toISOString(),
          photo_ids: vars.input.photo_ids ?? null,
          reference_attachment_ids: vars.input.reference_attachment_ids ?? null,
          voice_note_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = localResult;
          return updated;
        }
        return [...prev, localResult];
      });

      return {
        id: `local-${Date.now().toString(36)}`,
        checklist_item_id: vars.itemId,
        borgingsmoment_id: momentId,
        project_id: projectId,
        verdict: vars.input.verdict as InspectionVerdictValue,
        note: vars.input.note ?? null,
        inspector_user_id: 'local',
        inspected_at: new Date().toISOString(),
        photo_ids: vars.input.photo_ids ?? null,
        reference_attachment_ids: vars.input.reference_attachment_ids ?? null,
        voice_note_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    [projectId, momentId],
  );

  type R = UseMutationResult<ChecklistItemResult, Error, SubmitVars> & { isOfflineSubmit: boolean };

  if (!isOnline) {
    return {
      ...onlineMutation,
      mutate: ((vars: SubmitVars, options?: { onSuccess?: () => void }) => {
        void offlineMutate(vars).then(() => options?.onSuccess?.());
      }) as typeof onlineMutation.mutate,
      mutateAsync: offlineMutate as typeof onlineMutation.mutateAsync,
      isPending: false,
      isOfflineSubmit,
    } as R;
  }

  return { ...onlineMutation, isOfflineSubmit: false } as R;
}

// ---------------------------------------------------------------------------
// Offline start / complete inspection
// ---------------------------------------------------------------------------

export function useOfflineStartInspection(
  projectId: string,
  momentId: string,
): UseMutationResult<Borgingsmoment, Error, void> & { isOfflineSubmit: boolean } {
  const { isOnline } = useNetworkStatus();
  const onlineMutation = useStartInspection(projectId, momentId);

  type R = UseMutationResult<Borgingsmoment, Error, void> & { isOfflineSubmit: boolean };

  if (!isOnline) {
    const offlineMutate = async (): Promise<Borgingsmoment> => {
      await enqueueAction({
        type: 'start_inspection',
        projectId,
        momentId,
      });
      return {} as Borgingsmoment;
    };

    return {
      ...onlineMutation,
      mutate: ((_, options?: { onSuccess?: () => void }) => {
        void offlineMutate().then(() => options?.onSuccess?.());
      }) as typeof onlineMutation.mutate,
      mutateAsync: offlineMutate as typeof onlineMutation.mutateAsync,
      isPending: false,
      isOfflineSubmit: true,
    } as R;
  }

  return { ...onlineMutation, isOfflineSubmit: false } as R;
}

export function useOfflineCompleteInspection(
  projectId: string,
  momentId: string,
): UseMutationResult<Borgingsmoment, Error, void> & { isOfflineSubmit: boolean } {
  const { isOnline } = useNetworkStatus();
  const onlineMutation = useCompleteInspection(projectId, momentId);

  type R = UseMutationResult<Borgingsmoment, Error, void> & { isOfflineSubmit: boolean };

  if (!isOnline) {
    const offlineMutate = async (): Promise<Borgingsmoment> => {
      await enqueueAction({
        type: 'complete_inspection',
        projectId,
        momentId,
      });
      return {} as Borgingsmoment;
    };

    return {
      ...onlineMutation,
      mutate: ((_, options?: { onSuccess?: () => void }) => {
        void offlineMutate().then(() => options?.onSuccess?.());
      }) as typeof onlineMutation.mutate,
      mutateAsync: offlineMutate as typeof onlineMutation.mutateAsync,
      isPending: false,
      isOfflineSubmit: true,
    } as R;
  }

  return { ...onlineMutation, isOfflineSubmit: false } as R;
}
