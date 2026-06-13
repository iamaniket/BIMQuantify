'use client';

import { Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { AppDialog, Badge, Button } from '@bimstitch/ui';

import type { Finding } from '@/lib/api/schemas';

import { FindingDetailFields } from './FindingDetailFields';
import { statusBadgeVariant } from './findingBadges';
import { useFindingDetailForm } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FindingDetailModal({
  projectId,
  finding,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tStatus = useTranslations('findings.status');
  const api = useFindingDetailForm(projectId, finding, {
    onSaved: () => { onOpenChange(false); },
    onDeleted: () => { onOpenChange(false); },
  });

  if (finding === null) {
    return <></>;
  }

  const { confirmDelete, setConfirmDelete, isPending, canEdit, canDelete } = api;

  const deleteFooter = !canDelete ? undefined : confirmDelete ? (
    <div className="flex items-center gap-2">
      <span className="text-body3 text-foreground-secondary">
        {t('delete.confirm')}
      </span>
      <Button
        type="button"
        variant="destructive"
        size="md"
        disabled={isPending}
        onClick={api.remove}
      >
        {t('delete.confirmAction')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="md"
        onClick={() => { setConfirmDelete(false); }}
      >
        {t('delete.cancel')}
      </Button>
    </div>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="md"
      onClick={() => { setConfirmDelete(true); }}
    >
      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
      {t('delete.action')}
    </Button>
  );

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      headerMeta={(
        <Badge variant={statusBadgeVariant(finding.status)}>
          {tStatus(finding.status)}
        </Badge>
      )}
      {...(canEdit ? { onSave: api.save } : {})}
      saveLabel={t('save')}
      saveDisabled={isPending}
      footerInfo={deleteFooter}
      width={680}
    >
      <FindingDetailFields projectId={projectId} finding={finding} api={api} />
    </AppDialog>
  );
}
