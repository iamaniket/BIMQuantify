'use client';

import { FileText, Plus, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
} from '@bimstitch/ui';

import { useAttachments } from '@/features/attachments/useAttachments';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

type Props = {
  projectId: string;
  referenceIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
};

export function ReferenceDocumentPicker({
  projectId,
  referenceIds,
  onChange,
  disabled = false,
  label,
}: Props): JSX.Element {
  const t = useTranslations('findings.referenceDocuments');
  const [pickerOpen, setPickerOpen] = useState(false);
  const attachmentsQuery = useAttachments(projectId);
  const allAttachments = flattenPages(attachmentsQuery.data);

  const referenced = allAttachments.filter(
    (a) => a.status === 'ready' && referenceIds.includes(a.id),
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label ?? t('label')}
      </Label>
      {referenced.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {referenced.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-low px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-foreground-tertiary" />
              <span className="min-w-0 flex-1 truncate text-body3 text-foreground">
                {doc.original_filename}
              </span>
              {!disabled && (
                <button
                  type="button"
                  title={t('remove')}
                  onClick={() => {
                    onChange(referenceIds.filter((id) => id !== doc.id));
                  }}
                  className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-foreground-tertiary transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="self-start"
          onClick={() => { setPickerOpen(true); }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('add')}
        </Button>
      )}
      <PickerDialog
        projectId={projectId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludeIds={referenceIds}
        onPick={(id) => {
          onChange([...referenceIds, id]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function PickerDialog({
  projectId,
  open,
  onOpenChange,
  excludeIds,
  onPick,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeIds: string[];
  onPick: (attachmentId: string) => void;
}): JSX.Element {
  const t = useTranslations('findings.referenceDocuments');
  const attachmentsQuery = useAttachments(projectId);
  const candidates = flattenPages(attachmentsQuery.data).filter(
    (a) => a.status === 'ready' && !excludeIds.includes(a.id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pickerTitle')}</DialogTitle>
          <DialogDescription>{t('pickerDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {attachmentsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-6 text-center text-body3 text-foreground-tertiary">
              {t('empty')}
            </div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-auto">
              {candidates.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(doc.id); }}
                    className="flex w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-foreground-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground">
                      {doc.original_filename}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
