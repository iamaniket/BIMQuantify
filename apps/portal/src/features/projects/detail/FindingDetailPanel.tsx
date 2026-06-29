'use client';

import { Clock, FrameCorners, MessageSquare, Pencil, Trash2, X } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Badge, Button, IconButton, Tabs, TabsList, TabsTrigger } from '@bimdossier/ui';

import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import type { Finding } from '@/lib/api/schemas';

import { FindingCommentsTab } from './FindingCommentsTab';
import { FindingDetailFields } from './FindingDetailFields';
import { FindingHistoryTab } from './FindingHistoryTab';
import { statusBadgeVariant } from './findingBadges';
import { useFindingDetailForm } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding | null;
  onClose: () => void;
  /** When provided, render an "open in dialog" button beside the close button. */
  onExpand?: () => void;
};

type FindingTab = 'edit' | 'history' | 'comments';

/**
 * Jira-style right-rail detail panel — the dialog-free twin of
 * {@link FindingDetailModal}. Shares the same form controller and Edit/History
 * tabs, but renders as an inline column (`border-l` rail) so the board/calendar
 * keep their context visible while a finding is open. Renders nothing when
 * `finding` is `null`, mirroring the modal's closed state.
 */
export function FindingDetailPanel({ projectId, finding, onClose, onExpand }: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const tStatus = useTranslations('findings.status');
  // Comments + history are org-backed — hidden for free users (edit tab only).
  const { isFreeUser } = useIsFreeUser();
  const [tab, setTab] = useState<FindingTab>('edit');
  const api = useFindingDetailForm(projectId, finding, {
    onSaved: onClose,
    onDeleted: onClose,
  });

  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Reset to the Edit tab whenever the panel targets a new finding.
  const findingId = finding?.id ?? null;
  useEffect(() => {
    setTab('edit');
  }, [findingId]);

  // Move focus into the rail when it opens (and on finding switch), and restore
  // it to the element that opened the panel on close. Deliberately NOT a focus
  // trap — the board/calendar stay interactive behind this non-modal rail — but
  // it gives keyboard/AT users the open/close signal the old dialog provided.
  useEffect(() => {
    if (findingId === null) {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
      return;
    }
    if (triggerRef.current === null) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    }
    panelRef.current?.focus();
  }, [findingId]);

  // Close on Escape. Attached as a native listener (not a JSX `onKeyDown`) so the
  // `<aside>` keeps its `complementary` landmark role without carrying an event
  // handler. Events still bubble from inside the rail to this node, so Escape
  // closes the panel from anywhere within it — identical to the JSX handler.
  useEffect(() => {
    const node = panelRef.current;
    if (node === null) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    node.addEventListener('keydown', handleKeyDown);
    return () => {
      node.removeEventListener('keydown', handleKeyDown);
    };
  }, [findingId, onClose]);

  if (finding === null) {
    return <></>;
  }

  const { confirmDelete, setConfirmDelete, isPending, canEdit, canDelete } = api;
  const isEdit = tab === 'edit';

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={t('title')}
      className="flex w-[26rem] shrink-0 flex-col border-l border-border bg-surface-main outline-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body1 font-semibold text-foreground">
            {t('title')}
          </span>
          <Badge variant={statusBadgeVariant(finding.status)}>
            {tStatus(finding.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {onExpand !== undefined && (
            <IconButton icon={FrameCorners} aria-label={t('expand')} onClick={onExpand} />
          )}
          <IconButton icon={X} aria-label={t('close')} onClick={onClose} />
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-2">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as FindingTab); }}>
          <TabsList className="gap-1 rounded-none bg-transparent p-0">
            <TabsTrigger value="edit" className={TAB_TRIGGER_CLASS}>
              <Pencil className="h-4 w-4" />
              {t('tabs.edit')}
            </TabsTrigger>
            {!isFreeUser && (
              <>
                <TabsTrigger value="comments" className={TAB_TRIGGER_CLASS}>
                  <MessageSquare className="h-4 w-4" />
                  {t('tabs.comments')}
                </TabsTrigger>
                <TabsTrigger value="history" className={TAB_TRIGGER_CLASS}>
                  <Clock className="h-4 w-4" />
                  {t('tabs.history')}
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isEdit ? (
          <FindingDetailFields projectId={projectId} finding={finding} api={api} />
        ) : tab === 'comments' ? (
          <FindingCommentsTab projectId={projectId} finding={finding} />
        ) : (
          <FindingHistoryTab projectId={projectId} finding={finding} />
        )}
      </div>

      {isEdit && (canEdit || canDelete) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
          {canDelete && confirmDelete ? (
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
          ) : canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="text-error hover:text-error"
              onClick={() => { setConfirmDelete(true); }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t('delete.action')}
            </Button>
          ) : (
            <span />
          )}
          {canEdit && (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={isPending}
              onClick={api.save}
            >
              {t('save')}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
