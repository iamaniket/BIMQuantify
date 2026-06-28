'use client';

import { Clock, MessageSquare, Trash2 } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { AppDialog, Badge, Button, Tabs, TabsList, TabsTrigger } from '@bimdossier/ui';

import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';
import type { Finding } from '@/lib/api/schemas';

import { FindingCommentsTab } from './FindingCommentsTab';
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

type DiscussionTab = 'comments' | 'history';

export function FindingDetailModal({
  projectId,
  finding,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tStatus = useTranslations('findings.status');
  const tCommon = useTranslations('common');
  const [tab, setTab] = useState<DiscussionTab>('comments');
  const api = useFindingDetailForm(projectId, finding, {
    onSaved: () => { onOpenChange(false); },
    onDeleted: () => { onOpenChange(false); },
  });

  // The edit form is always shown; the bottom strip toggles between the
  // discussion and the audit history. Reset to comments on (re)open / new finding.
  const findingId = finding?.id ?? null;
  useEffect(() => {
    if (open) setTab('comments');
  }, [open, findingId]);

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
      cancelLabel={tCommon('cancel')}
      saveDisabled={isPending}
      // `deleteFooter` is undefined when the user can't delete; the fallback keeps
      // a footer node so Cancel always renders (the dialog has no header ✕ and
      // outside-click is disabled — a read-only viewer would otherwise be trapped).
      footerInfo={deleteFooter ?? <span aria-hidden />}
      width={760}
      height={720}
      // Strip the body's own padding/gap so its three regions control their own
      // scroll + padding. The body keeps its default overflow-y-auto as a harmless
      // fallback (in the happy path the capped form + flex-filling comments region
      // fit exactly, so only the inner regions scroll).
      bodyClassName="p-0 gap-0"
    >
      {/* Pinned form: natural height up to a cap, scrolls internally only if taller. */}
      <div className="shrink-0 max-h-[60%] overflow-y-auto px-5 pt-4 pb-2">
        <FindingDetailFields projectId={projectId} finding={finding} api={api} wide />
      </div>

      {/* Discussion strip — Comments / History toggle below the form. */}
      <div className="shrink-0 border-t border-border px-5">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as DiscussionTab); }}>
          <TabsList className="gap-1 rounded-none bg-transparent p-0">
            <TabsTrigger value="comments" className={TAB_TRIGGER_CLASS}>
              <MessageSquare className="h-4 w-4" />
              {t('tabs.comments')}
            </TabsTrigger>
            <TabsTrigger value="history" className={TAB_TRIGGER_CLASS}>
              <Clock className="h-4 w-4" />
              {t('tabs.history')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Independently-scrolling discussion region. `key` remounts on tab switch
          so the inner scroll resets to the top. */}
      <div key={tab} className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {tab === 'comments' ? (
          <FindingCommentsTab projectId={projectId} finding={finding} />
        ) : (
          <FindingHistoryTab projectId={projectId} finding={finding} />
        )}
      </div>
    </AppDialog>
  );
}
