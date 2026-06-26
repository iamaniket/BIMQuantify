'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Select } from '@bimdossier/ui';

import { useUpdateDocument } from '@/features/documents/useUpdateDocument';
import type { Level } from '@/lib/api/schemas';

type Props = {
  projectId: string;
  documentId: string;
  levelId: string | null;
  levels: Level[];
  disabled?: boolean;
};

/** Assign / move a 2D drawing document to a project level (or detach → Unassigned). */
export function LevelAssignSelect({
  projectId,
  documentId,
  levelId,
  levels,
  disabled = false,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.assignLevel');
  const updateMutation = useUpdateDocument();

  return (
    <Select
      selectSize="sm"
      aria-label={t('label')}
      value={levelId ?? ''}
      disabled={disabled || updateMutation.isPending}
      onClick={(e) => { e.stopPropagation(); }}
      onChange={(e) => {
        const value = e.target.value;
        updateMutation.mutate({
          projectId,
          documentId,
          input: { level_id: value === '' ? null : value },
        });
      }}
      className="w-auto min-w-[8rem]"
    >
      <option value="">{t('unassigned')}</option>
      {levels.map((lvl) => (
        <option key={lvl.id} value={lvl.id}>
          {lvl.name}
        </option>
      ))}
    </Select>
  );
}
