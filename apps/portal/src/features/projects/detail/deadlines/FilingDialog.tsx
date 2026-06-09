'use client';

import { AlertTriangle, Check, CheckCircle2, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from '@bimstitch/ui';

import type { Deadline } from '@/lib/api/schemas/deadlines';

import { useDeadlineReadiness, useFileDeadline } from './useDeadlines';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  deadline: Deadline;
  label: string;
};

export function FilingDialog({
  open,
  onOpenChange,
  projectId,
  deadline,
  label,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines.filing');
  const [step, setStep] = useState<0 | 1>(0);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [filingNotes, setFilingNotes] = useState('');

  const readiness = useDeadlineReadiness(
    projectId,
    open ? deadline.id : null,
  );
  const fileMutation = useFileDeadline(projectId);

  function handleOpenChange(next: boolean): void {
    if (!next) {
      setStep(0);
      setReferenceNumber('');
      setFilingNotes('');
    }
    onOpenChange(next);
  }

  function handleConfirm(): void {
    fileMutation.mutate(
      {
        deadlineId: deadline.id,
        body: {
          reference_number: referenceNumber || undefined,
          filing_notes: filingNotes || undefined,
        },
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
      },
    );
  }

  const data = readiness.data;
  const isReady = data?.is_ready ?? false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-48px)] max-w-none flex-col"
        style={{ width: 520, maxWidth: 'calc(100vw - 48px)' }}
      >
        <DialogHeader>
          <DialogTitle>{t('dialogTitle', { label })}</DialogTitle>
          <DialogDescription>
            {step === 0 ? t('readinessHeading') : t('referenceLabel')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          {step === 0 ? (
            <ReadinessStep
              isLoading={readiness.isLoading}
              items={data?.items ?? []}
              readyCount={data?.ready_count ?? 0}
              totalRequired={data?.total_required ?? 0}
              isReady={isReady}
            />
          ) : (
            <FilingStep
              referenceNumber={referenceNumber}
              onReferenceChange={setReferenceNumber}
              filingNotes={filingNotes}
              onNotesChange={setFilingNotes}
            />
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          {step === 0 ? (
            <>
              <DialogClose asChild>
                <Button type="button" variant="border" size="md">
                  {t('cancel')}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => { setStep(1); }}
                disabled={readiness.isLoading}
              >
                {t('next')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="border"
                size="md"
                onClick={() => { setStep(0); }}
              >
                {t('back')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleConfirm}
                disabled={fileMutation.isPending}
              >
                {t('confirmButton')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Readiness checklist
// ---------------------------------------------------------------------------

type ReadinessStepProps = {
  isLoading: boolean;
  items: Array<{
    code: string;
    label: string;
    category: string;
    required: boolean;
    fulfilled: boolean;
    count: number;
  }>;
  readyCount: number;
  totalRequired: number;
  isReady: boolean;
};

function ReadinessStep({
  isLoading,
  items,
  readyCount,
  totalRequired,
  isReady,
}: ReadinessStepProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines.filing');

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3">
        <div className="flex items-center gap-2 text-body3 text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{t('allReady')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!isReady && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="text-body3 text-foreground-secondary">
            {t('warningIncomplete')}
          </span>
        </div>
      )}

      <p className="text-body3 text-foreground-secondary">
        {t('readyCount', { ready: readyCount, total: totalRequired })}
      </p>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.code}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-body3"
          >
            {item.fulfilled ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0 text-error" />
            )}
            <span className={item.fulfilled ? 'text-foreground-secondary' : 'text-foreground'}>
              {item.label}
            </span>
            {!item.required && (
              <span className="ml-auto text-caption text-foreground-tertiary">
                {t('optional')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Reference number + notes
// ---------------------------------------------------------------------------

type FilingStepProps = {
  referenceNumber: string;
  onReferenceChange: (v: string) => void;
  filingNotes: string;
  onNotesChange: (v: string) => void;
};

function FilingStep({
  referenceNumber,
  onReferenceChange,
  filingNotes,
  onNotesChange,
}: FilingStepProps): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines.filing');

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="filing-ref">{t('referenceLabel')}</Label>
        <Input
          id="filing-ref"
          value={referenceNumber}
          onChange={(e) => { onReferenceChange(e.target.value); }}
          placeholder={t('referencePlaceholder')}
          maxLength={100}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filing-notes">{t('notesLabel')}</Label>
        <Textarea
          id="filing-notes"
          value={filingNotes}
          onChange={(e) => { onNotesChange(e.target.value); }}
          placeholder={t('notesPlaceholder')}
          rows={3}
        />
      </div>

      <p className="text-caption text-foreground-tertiary">
        {t('confirmHint')}
      </p>
    </div>
  );
}
