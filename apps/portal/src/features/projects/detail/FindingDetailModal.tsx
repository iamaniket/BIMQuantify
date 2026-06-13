'use client';

import { Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { AppDialog, Badge, Button, Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Finding } from '@/lib/api/schemas';

import { FindingDetailFields } from './FindingDetailFields';
import { FindingHistoryTab } from './FindingHistoryTab';
import { statusBadgeVariant } from './findingBadges';
import { useFindingDetailForm } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FindingTab = 'edit' | 'history';

export function FindingDetailModal({
  projectId,
  finding,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tStatus = useTranslations('findings.status');
  const [tab, setTab] = useState<FindingTab>('edit');
  const api = useFindingDetailForm(projectId, finding, {
    onSaved: () => { onOpenChange(false); },
    onDeleted: () => { onOpenChange(false); },
  });

  // Reset to the Edit tab whenever the dialog (re)opens or targets a new finding.
  const findingId = finding?.id ?? null;
  useEffect(() => {
    if (open) setTab('edit');
  }, [open, findingId]);

  if (finding === null) {
    return <></>;
  }

  const { confirmDelete, setConfirmDelete, isPending, canEdit, canDelete } = api;
  const isEdit = tab === 'edit';

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
      {...(isEdit && canEdit ? { onSave: api.save } : {})}
      saveLabel={t('save')}
      saveDisabled={isPending}
      // Save/Delete belong to the Edit tab only. On History keep a minimal
      // footer node so the Cancel/Close button still renders (the dialog has no
      // header ✕ and outside-click is disabled).
      footerInfo={isEdit ? deleteFooter : <span aria-hidden />}
      width={680}
    >
      <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-1 border-b border-border bg-background px-5 pb-2.5 pt-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as FindingTab); }}>
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="edit">{t('tabs.edit')}</TabsTrigger>
            <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {isEdit ? (
        <FindingDetailFields projectId={projectId} finding={finding} api={api} />
      ) : (
        <FindingHistoryTab projectId={projectId} finding={finding} />
      )}
    </AppDialog>
  );
}
