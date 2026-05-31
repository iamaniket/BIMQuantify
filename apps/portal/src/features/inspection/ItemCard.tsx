'use client';

import { Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button } from '@bimstitch/ui';

import type {
  ChecklistItem,
  ChecklistItemResult,
  InspectionVerdictValue,
} from '@/lib/api/schemas';

import { ReferenceDocumentPicker } from '@/features/projects/detail/ReferenceDocumentPicker';

import { NoteField } from './NoteField';
import { PhotoCapture } from './PhotoCapture';
import { VerdictButtons } from './VerdictButtons';

type Props = {
  projectId: string;
  item: ChecklistItem;
  existingResult: ChecklistItemResult | null;
  onSubmit: (verdict: InspectionVerdictValue, note: string | null, photoIds: string[] | null, referenceAttachmentIds: string[] | null) => void;
  isPending: boolean;
  isCompleted: boolean;
};

export function ItemCard({
  projectId,
  item,
  existingResult,
  onSubmit,
  isPending,
  isCompleted,
}: Props): JSX.Element {
  const t = useTranslations('inspection');
  const tEv = useTranslations('projectDetail.tabs.borgingsplan.plan.evidenceTypes');

  const [verdict, setVerdict] = useState<InspectionVerdictValue | null>(
    existingResult?.verdict ?? null,
  );
  const [note, setNote] = useState(existingResult?.note ?? '');
  const [photoIds, setPhotoIds] = useState<string[]>(existingResult?.photo_ids ?? []);
  const [referenceAttachmentIds, setReferenceAttachmentIds] = useState<string[]>(
    existingResult?.reference_attachment_ids ?? [],
  );

  useEffect(() => {
    setVerdict(existingResult?.verdict ?? null);
    setNote(existingResult?.note ?? '');
    setPhotoIds(existingResult?.photo_ids ?? []);
    setReferenceAttachmentIds(existingResult?.reference_attachment_ids ?? []);
  }, [existingResult, item.id]);

  const handleVerdictSelect = useCallback(
    (v: InspectionVerdictValue) => {
      setVerdict(v);
      if (v !== 'not_applicable') {
        onSubmit(v, note.trim().length > 0 ? note.trim() : null, photoIds.length > 0 ? photoIds : null, referenceAttachmentIds.length > 0 ? referenceAttachmentIds : null);
      }
    },
    [note, photoIds, referenceAttachmentIds, onSubmit],
  );

  const handleNoteSubmit = useCallback(() => {
    if (verdict === null) return;
    if (verdict === 'not_applicable' && note.trim().length === 0) return;
    onSubmit(verdict, note.trim().length > 0 ? note.trim() : null, photoIds.length > 0 ? photoIds : null, referenceAttachmentIds.length > 0 ? referenceAttachmentIds : null);
  }, [verdict, note, photoIds, referenceAttachmentIds, onSubmit]);

  const handlePhotosChange = useCallback(
    (ids: string[]) => {
      setPhotoIds(ids);
      if (verdict !== null && verdict !== 'not_applicable') {
        onSubmit(verdict, note.trim().length > 0 ? note.trim() : null, ids.length > 0 ? ids : null, referenceAttachmentIds.length > 0 ? referenceAttachmentIds : null);
      }
    },
    [verdict, note, referenceAttachmentIds, onSubmit],
  );

  const handleReferenceChange = useCallback(
    (ids: string[]) => {
      setReferenceAttachmentIds(ids);
      if (verdict !== null && verdict !== 'not_applicable') {
        onSubmit(verdict, note.trim().length > 0 ? note.trim() : null, photoIds.length > 0 ? photoIds : null, ids.length > 0 ? ids : null);
      }
    },
    [verdict, note, photoIds, onSubmit],
  );

  const nvtNeedsNote = verdict === 'not_applicable' && note.trim().length === 0;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{tEv(item.evidence_type)}</Badge>
        {item.bbl_article_ref !== null && (
          <span className="text-caption text-foreground-tertiary">
            {item.bbl_article_ref}
          </span>
        )}
      </div>

      <p className="text-body1 font-medium text-foreground">{item.description}</p>

      {item.pass_fail_criteria !== null && item.pass_fail_criteria.length > 0 && (
        <div className="rounded-md border border-border bg-background-secondary px-3 py-2">
          <p className="text-caption font-medium text-foreground-secondary">
            {t('item.criteria')}
          </p>
          <p className="text-body2 text-foreground">{item.pass_fail_criteria}</p>
        </div>
      )}

      <VerdictButtons
        selected={verdict}
        onSelect={handleVerdictSelect}
        disabled={isPending || isCompleted}
      />

      <NoteField
        value={note}
        onChange={setNote}
        required={verdict === 'not_applicable'}
        disabled={isPending || isCompleted}
      />

      {verdict === 'not_applicable' && (
        <Button
          variant="primary"
          size="md"
          onClick={handleNoteSubmit}
          disabled={isPending || nvtNeedsNote || isCompleted}
          className="w-full"
        >
          {t('item.saveNote')}
        </Button>
      )}

      <PhotoCapture
        projectId={projectId}
        photoIds={photoIds}
        onChange={handlePhotosChange}
        disabled={isCompleted}
      />

      <ReferenceDocumentPicker
        projectId={projectId}
        referenceIds={referenceAttachmentIds}
        onChange={handleReferenceChange}
        disabled={isCompleted}
        label={t('referenceDocuments.label')}
      />

      <Button
        variant="ghost"
        size="md"
        className="min-h-12 gap-1.5"
        onClick={() => toast.info(t('voiceNote.comingSoon'))}
        disabled={isCompleted}
      >
        <Mic className="h-5 w-5" />
        {t('voiceNote.label')}
      </Button>
    </div>
  );
}
