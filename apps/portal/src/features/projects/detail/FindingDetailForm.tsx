'use client';

import { Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type { DocumentViewerHandle, ViewerHandle } from '@bimstitch/viewer';

import type { Finding, LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingDetailFields } from './FindingDetailFields';
import { useFindingDetailForm } from './useFindingDetailForm';

type Props = {
  projectId: string;
  finding: Finding;
  /** Fired after a successful save/promote/resolve/verify. */
  onSaved?: () => void;
  /** Fired after a successful delete. */
  onDeleted?: () => void;
  documentHandle?: DocumentViewerHandle | null | undefined;
  viewerHandle?: ViewerHandle | null | undefined;
  activeFileType?: LinkedFileTypeValue | null | undefined;
};

/**
 * In-panel finding editor — the dialog-free counterpart to `FindingDetailModal`.
 * Renders the shared {@link FindingDetailFields} plus its own Save/Delete action
 * row, so it drops straight into an expanded inspector row (no modal chrome).
 */
export function FindingDetailForm({
  projectId,
  finding,
  onSaved,
  onDeleted,
  documentHandle,
  viewerHandle,
  activeFileType,
}: Props): JSX.Element {
  const t = useTranslations('findings.detail');
  const api = useFindingDetailForm(projectId, finding, { onSaved, onDeleted });
  const { confirmDelete, setConfirmDelete, isPending, canEdit, canDelete } = api;

  return (
    <div className="flex flex-col gap-3 py-1">
      <FindingDetailFields
        projectId={projectId}
        finding={finding}
        api={api}
        documentHandle={documentHandle}
        viewerHandle={viewerHandle}
        activeFileType={activeFileType}
      />

      {(canEdit || canDelete) && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
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
    </div>
  );
}
