'use client';

import { Camera, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button } from '@bimstitch/ui';

import type {
  ChecklistItem,
  ChecklistItemResult,
  InspectionVerdictValue,
} from '@/lib/api/schemas';

import { NoteField } from './NoteField';
import { VerdictButtons } from './VerdictButtons';

type Props = {
  item: ChecklistItem;
  existingResult: ChecklistItemResult | null;
  onSubmit: (verdict: InspectionVerdictValue, note: string | null) => void;
  isPending: boolean;
  isCompleted: boolean;
};

export function ItemCard({
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

  useEffect(() => {
    setVerdict(existingResult?.verdict ?? null);
    setNote(existingResult?.note ?? '');
  }, [existingResult, item.id]);

  const handleVerdictSelect = useCallback(
    (v: InspectionVerdictValue) => {
      setVerdict(v);
      if (v !== 'not_applicable') {
        onSubmit(v, note.trim().length > 0 ? note.trim() : null);
      }
    },
    [note, onSubmit],
  );

  const handleNoteSubmit = useCallback(() => {
    if (verdict === null) return;
    if (verdict === 'not_applicable' && note.trim().length === 0) return;
    onSubmit(verdict, note.trim().length > 0 ? note.trim() : null);
  }, [verdict, note, onSubmit]);

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

      <p className="text-body2 font-medium text-foreground">{item.description}</p>

      {item.pass_fail_criteria !== null && item.pass_fail_criteria.length > 0 && (
        <div className="rounded-md border border-border bg-background-secondary px-3 py-2">
          <p className="text-caption font-medium text-foreground-secondary">
            {t('item.criteria')}
          </p>
          <p className="text-body3 text-foreground">{item.pass_fail_criteria}</p>
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

      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toast.info(t('photo.comingSoon'))}
          disabled={isCompleted}
        >
          <Camera className="mr-1.5 h-4 w-4" />
          {t('photo.label')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toast.info(t('voiceNote.comingSoon'))}
          disabled={isCompleted}
        >
          <Mic className="mr-1.5 h-4 w-4" />
          {t('voiceNote.label')}
        </Button>
      </div>
    </div>
  );
}
