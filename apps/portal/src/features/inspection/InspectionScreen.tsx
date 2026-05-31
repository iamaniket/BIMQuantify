'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';

import { Button, Skeleton } from '@bimstitch/ui';

import { useRouter } from '@/i18n/navigation';
import type {
  Borgingsmoment,
  ChecklistItem,
  InspectionVerdictValue,
} from '@/lib/api/schemas';

import {
  useCompleteInspection,
  useInspectionResults,
  useInspectionSummary,
  useStartInspection,
  useSubmitResult,
} from './useInspection';
import { CompletionDialog } from './CompletionDialog';
import { InspectionHeader } from './InspectionHeader';
import { ItemCard } from './ItemCard';
import { ProgressBar } from './ProgressBar';

type Props = {
  projectId: string;
  moment: Borgingsmoment;
};

export function InspectionScreen({ projectId, moment }: Props): JSX.Element {
  const t = useTranslations('inspection');
  const router = useRouter();

  const items = useMemo(
    () => moment.checklist_items.slice().sort((a, b) => a.sequence - b.sequence),
    [moment.checklist_items],
  );

  const [currentIdx, setCurrentIdx] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);

  const resultsQuery = useInspectionResults(moment.id);
  const summaryQuery = useInspectionSummary(moment.id);
  const startMutation = useStartInspection(projectId, moment.id);
  const submitMutation = useSubmitResult(moment.id);
  const completeMutation = useCompleteInspection(projectId, moment.id);

  const results = resultsQuery.data ?? [];
  const summary = summaryQuery.data ?? null;

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
            disabled={startMutation.isPending || items.length === 0}
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
      <InspectionHeader
        projectId={projectId}
        momentName={moment.name}
        status={moment.status}
      />

      <div className="flex items-center justify-between border-b border-border bg-background-secondary px-4 py-2">
        <span className="text-caption font-medium text-foreground-secondary">
          {t('stepper.item', { current: currentIdx + 1, total: items.length })}
        </span>
        {allDone && !isTerminal && (
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
          item={currentItem}
          existingResult={resultByItemId.get(currentItem.id) ?? null}
          onSubmit={handleSubmit}
          isPending={submitMutation.isPending}
          isCompleted={isTerminal}
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
