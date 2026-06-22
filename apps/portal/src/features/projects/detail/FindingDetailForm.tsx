'use client';

import { Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type { DocumentViewerHandle, FloorPlanViewerHandle, ViewerHandle } from '@bimstitch/viewer';

import type { ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import type { Finding, LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingDetailFields } from './FindingDetailFields';
import type { ConvertFloorPlanPoint } from './FindingPinButton';
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
  /** Active model/file to attach when pinning a previously-unlinked finding. */
  activeModelId?: string | null | undefined;
  activeFileId?: string | null | undefined;
  /** Resolve the picked element's GlobalId (active model only), else null. */
  resolvePickedGlobalId?: ((item: { modelId: string; localId: number } | null) => string | null) | undefined;
  /** Current viewport layout — routes IFC picks to the floor-plan in 2D mode. */
  viewMode?: ViewMode | undefined;
  /** Floor-plan handle (2D plan surface) for picking in 2D mode. */
  floorPlanHandle?: FloorPlanViewerHandle | null | undefined;
  /** Convert a normalized plan point to a 3D world anchor. */
  convertFloorPlanPoint?: ConvertFloorPlanPoint | undefined;
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
  activeModelId,
  activeFileId,
  resolvePickedGlobalId,
  viewMode,
  floorPlanHandle,
  convertFloorPlanPoint,
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
        activeModelId={activeModelId}
        activeFileId={activeFileId}
        resolvePickedGlobalId={resolvePickedGlobalId}
        viewMode={viewMode}
        floorPlanHandle={floorPlanHandle}
        convertFloorPlanPoint={convertFloorPlanPoint}
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
