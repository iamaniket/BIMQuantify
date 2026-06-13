'use client';

import { ChevronLeft, ChevronRight } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Button, Skeleton } from '@bimstitch/ui';

import { OfflineBanner } from '@/components/OfflineBanner';
import { useProjectPermissions } from '@/features/permissions';
import { useRouter } from '@/i18n/navigation';
import type {
  Borgingsmoment,
  Borgingsplan,
  ChecklistItem,
  InspectionVerdictValue,
} from '@/lib/api/schemas';
import { getEntriesForMoment } from '@/lib/offline/queue.js';
import type { QueueEntryStatus, SubmitResultEntry } from '@/lib/offline/types.js';

import { CompletionDialog } from './CompletionDialog';
import { InspectionHeader } from './InspectionHeader';
import { ItemCard } from './ItemCard';
import { ProgressBar } from './ProgressBar';
import { useInspectionCacheSync } from './useInspectionCacheSync';
import {
  useOfflineCompleteInspection,
  useOfflineInspectionResults,
  useOfflineInspectionSummary,
  useOfflineStartInspection,
  useOfflineSubmitResult,
} from './useOfflineInspection';

type Props = {
  projectId: string;
  moment: Borgingsmoment;
  plan?: Borgingsplan | undefined;
};

export function InspectionScreen({ projectId, moment, plan }: Props): JSX.Element {
  const t = useTranslations('inspection');
  const router = useRouter();
  const { can } = useProjectPermissions(projectId);
  // Inspection start / submit-result / complete are all gated on
  // Resource.inspection update (owner, editor, inspector). Others view-only.
  const canInspect = can('inspection', 'update');

  const items = useMemo(
    () => moment.checklist_items.slice().sort((a, b) => a.sequence - b.sequence),
    [moment.checklist_items],
  );

  const [currentIdx, setCurrentIdx] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);

  const resultsQuery = useOfflineInspectionResults(moment.id);
  const results = resultsQuery.data ?? [];
  const summaryQuery = useOfflineInspectionSummary(moment.id, items.length, results);
  const startMutation = useOfflineStartInspection(projectId, moment.id);
  const submitMutation = useOfflineSubmitResult(projectId, moment.id);
  const completeMutation = useOfflineCompleteInspection(projectId, moment.id);

  const summary = summaryQuery.data ?? null;

  useInspectionCacheSync(projectId, moment.id, plan ?? null, resultsQuery.data);

  const [syncStatuses, setSyncStatuses] = useState<Map<string, QueueEntryStatus>>(new Map());
  useEffect(() => {
    const load = (): void => {
      void getEntriesForMoment(moment.id).then((entries) => {
        const map = new Map<string, QueueEntryStatus>();
        for (const e of entries) {
          if (e.type === 'submit_result' && e.status !== 'succeeded') {
            map.set((e as SubmitResultEntry).payload.itemId, e.status);
          }
        }
        setSyncStatuses(map);
      });
    };
    load();
    const interval = setInterval(load, 3000);
    return () => { clearInterval(interval); };
  }, [moment.id, results]);

  const resultByItemId = useMemo(() => {
    const map = new Map<string, (typeof results)[number]>();
    for (const r of results) {
      map.set(r.checklist_item_id, r);
    }
    return map;
  }, [results]);

  const currentItem: ChecklistItem | undefined = items[currentIdx];
  const isTerminal = moment.status === 'passed' || moment.status === 'failed' || moment.status === 'skipped';
  const isInProgress = moment.status === 'in_progress';

  const handleStart = useCallback(() => {
    startMutation.mutate();
  }, [startMutation]);

  const handleSubmit = useCallback(
    (verdict: InspectionVerdictValue, note: string | null, photoIds: string[] | null, referenceAttachmentIds: string[] | null) => {
      if (currentItem === undefined) return;
      submitMutation.mutate(
        { itemId: currentItem.id, input: { verdict, note, photo_ids: photoIds, reference_attachment_ids: referenceAttachmentIds } },
        {
          onSuccess: () => {
            if (currentIdx < items.length - 1) {
              setCurrentIdx((i) => i + 1);
            }
          },
        },
      );
    },
    [currentItem, currentIdx, items.length, submitMutation],
  );

  const handleComplete = useCallback(() => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        setShowCompletion(false);
        router.push(`/projects/${projectId}`);
      },
    });
  }, [completeMutation, projectId, router]);

  if (moment.status === 'planned') {
    return (
      <div className="flex flex-1 flex-col">
        <InspectionHeader
          projectId={projectId}
          momentName={moment.name}
          status={moment.status}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <p className="text-center text-body2 text-foreground-secondary">
            {t('start.description', { count: items.length })}
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={handleStart}
            disabled={startMutation.isPending || items.length === 0 || !canInspect}
          >
            {t('start.button')}
          </Button>
        </div>
      </div>
    );
  }

  if (currentItem === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <InspectionHeader
          projectId={projectId}
          momentName={moment.name}
          status={moment.status}
        />
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-48 w-72" />
        </div>
      </div>
    );
  }

  const allDone = summary !== null && summary.remaining === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <OfflineBanner />
      <InspectionHeader
        projectId={projectId}
        momentName={moment.name}
        status={moment.status}
      />

      <div className="flex items-center justify-between border-b border-border bg-background-secondary px-4 py-2">
        <span className="text-caption font-medium text-foreground-secondary">
          {t('stepper.item', { current: currentIdx + 1, total: items.length })}
        </span>
        {allDone && !isTerminal && canInspect && (
          <Button
            variant="primary"
            size="md"
            className="min-h-12"
            onClick={() => setShowCompletion(true)}
          >
            {t('complete.button')}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ItemCard
          key={currentItem.id}
          projectId={projectId}
          momentId={moment.id}
          item={currentItem}
          existingResult={resultByItemId.get(currentItem.id) ?? null}
          onSubmit={handleSubmit}
          isPending={submitMutation.isPending}
          isCompleted={isTerminal || !canInspect}
          syncStatus={syncStatuses.get(currentItem.id)}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border bg-background px-4 py-3">
        <Button
          variant="ghost"
          size="lg"
          className="min-h-12 min-w-12 gap-1"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
        >
          <ChevronLeft className="h-5 w-5" />
          {t('stepper.prev')}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="min-h-12 min-w-12 gap-1"
          onClick={() => setCurrentIdx((i) => Math.min(items.length - 1, i + 1))}
          disabled={currentIdx >= items.length - 1}
        >
          {t('stepper.next')}
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <ProgressBar
        completed={summary?.completed ?? 0}
        total={summary?.total_items ?? items.length}
        failed={summary?.failed ?? 0}
      />

      <CompletionDialog
        open={showCompletion}
        onClose={() => setShowCompletion(false)}
        onConfirm={handleComplete}
        summary={summary}
        isPending={completeMutation.isPending}
      />
    </div>
  );
}
