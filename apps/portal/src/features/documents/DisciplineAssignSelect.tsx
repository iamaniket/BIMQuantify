'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Select } from '@bimdossier/ui';

import type { ModelDisciplineValue } from '@/lib/api/schemas';
import { DISCIPLINE_OPTIONS } from '@/lib/formatting/models';

import { useUpdateDocument } from './useUpdateDocument';

type Props = {
  projectId: string;
  documentId: string;
  discipline: ModelDisciplineValue;
  disabled?: boolean;
};

/** Set / change a document's discipline after creation (it defaults to "other"). */
export function DisciplineAssignSelect({
  projectId,
  documentId,
  discipline,
  disabled = false,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.assignDiscipline');
  const updateMutation = useUpdateDocument();

  return (
    <Select
      selectSize="md"
      aria-label={t('label')}
      value={discipline}
      disabled={disabled || updateMutation.isPending}
      onClick={(e) => { e.stopPropagation(); }}
      onChange={(e) => {
        updateMutation.mutate({
          projectId,
          documentId,
          input: { discipline: e.target.value as ModelDisciplineValue },
        });
      }}
      // `md` (h-[30px]) matches the sibling RowActionPill action buttons; the
      // body3 override keeps the font in step with their 12px pill labels.
      className="w-auto min-w-[8rem] text-body3"
    >
      {DISCIPLINE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {t(`options.${opt.value}`)}
        </option>
      ))}
    </Select>
  );
}
