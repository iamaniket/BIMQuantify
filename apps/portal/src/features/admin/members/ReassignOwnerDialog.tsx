'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { AppDialog, Label } from '@bimstitch/ui';

import type { MemberRead } from '@/lib/api/schemas';

type Props = {
  open: boolean;
  projectIds: string[];
  candidates: MemberRead[];
  onConfirm: (newOwnerId: string) => void;
  onCancel: () => void;
};

export function ReassignOwnerDialog({
  open,
  projectIds,
  candidates,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const t = useTranslations('admin.members.reassign');
  const [selected, setSelected] = useState<string>('');

  return (
    <AppDialog
      open={open}
      onClose={onCancel}
      title={t('title')}
      subtitle={t('subtitle', { count: projectIds.length })}
      onSave={() => {
        if (selected !== '') onConfirm(selected);
      }}
      saveLabel={t('confirm')}
      saveDisabled={selected === '' || candidates.length === 0}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reassign-target">{t('selectLabel')}</Label>
        <select
          id="reassign-target"
          className="h-9 rounded-md border border-border bg-background px-2 text-body3"
          value={selected}
          onChange={(e) => { setSelected(e.target.value); }}
        >
          <option value="" disabled>
            {t('selectPlaceholder')}
          </option>
          {candidates.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.full_name ?? c.email}
            </option>
          ))}
        </select>
      </div>
    </AppDialog>
  );
}
