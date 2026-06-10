'use client';

import { Info } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { ContextLine } from '@/components/shared/viewer/shared/ContextLine';
import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { ElementHeader } from '@/features/viewer/3d/properties/ElementHeader';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { EntityFindingsBody } from './EntityFindingsBody';
import { OrphanedItemsNotice } from './OrphanedItemsNotice';
import { useSelectedElement } from './useSelectedElement';

type EntityInspectorPanelProps = {
  metadata: ModelMetadata | undefined;
  projectId: string;
  modelId: string;
  fileId: string;
  /** When set, the findings body auto-opens its create form. */
  requestedView?: 'findings' | undefined;
  /** Nonce that increments on each new request, so repeated requests re-fire. */
  requestNonce?: number | undefined;
  isPdf?: boolean;
  pdfCurrentPage?: number;
};

/**
 * The viewer inspector — a single shared **findings** panel for both the 3D IFC
 * viewer and the 2D PDF viewer. Attachments and certificates are no longer
 * anchored to the model; they live at the project level (project detail tabs /
 * org certificate library), so the inspector keeps findings only. The header
 * differs only in how findings are *scoped*: 3D scopes by selected element (or
 * project when nothing is selected); PDF scopes findings by the open file.
 */
export function EntityInspectorPanel({
  metadata,
  projectId,
  modelId,
  fileId,
  requestedView,
  requestNonce,
  isPdf,
  pdfCurrentPage,
}: EntityInspectorPanelProps): JSX.Element {
  const t = useTranslations('viewerInspector');
  const tAttachments = useTranslations('viewerAttachments');
  const [consumedNonce, setConsumedNonce] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (requestedView !== undefined && requestNonce !== undefined) {
      // A new external trigger resets the consumed state so the body can fire once.
      setConsumedNonce(undefined);
    }
  }, [requestedView, requestNonce]);

  const autoOpenNonce =
    requestedView !== undefined &&
    requestNonce !== undefined &&
    requestNonce !== consumedNonce
      ? requestNonce
      : undefined;

  const handleAutoOpenConsumed = (): void => { setConsumedNonce(requestNonce); };

  const {
    element,
    selectedAll,
    hasSelection,
    isMultiSelection,
  } = useSelectedElement(metadata);

  const isProjectMode = isPdf !== true && !hasSelection;

  // --- Early states (after all hooks) ---
  if (isPdf === true) {
    if (pdfCurrentPage === undefined) {
      return <PanelEmptyState icon={Info} message={t('messages.pdfNotInitialized')} />;
    }
  } else if (selectedAll) {
    const storeTotalElements = useViewerEntityStore.getState().totalElements;
    const count = storeTotalElements > 0 ? storeTotalElements : (metadata?.totalElements ?? 0);
    return <PanelEmptyState icon={Info} message={t('messages.allSelected', { count })} />;
  } else if (isMultiSelection) {
    return <PanelEmptyState icon={Info} message={tAttachments('emptyMultiSelection')} />;
  } else if (!isProjectMode && element === null) {
    return <PanelEmptyState icon={Info} message={t('messages.noElementData')} />;
  }

  // --- Header + findings body for the active scope ---
  let header: JSX.Element;
  let body: JSX.Element;

  if (isPdf === true && pdfCurrentPage !== undefined) {
    header = <ContextLine tag="PDF" name={t('pdfPageHeader', { page: pdfCurrentPage })} />;
    body = (
      <EntityFindingsBody
        projectId={projectId}
        scope={{ kind: 'file', fileId }}
        autoOpenNonce={autoOpenNonce}
        onAutoOpenConsumed={handleAutoOpenConsumed}
      />
    );
  } else if (isProjectMode) {
    header = (
      <ElementHeader
        type={metadata?.schema ?? 'IFC'}
        name={metadata?.project.name ?? null}
      />
    );
    body = (
      <EntityFindingsBody
        projectId={projectId}
        scope={{ kind: 'project' }}
        autoOpenNonce={autoOpenNonce}
        onAutoOpenConsumed={handleAutoOpenConsumed}
      />
    );
  } else if (element !== null) {
    header = <ElementHeader name={element.name} type={element.type} />;
    const { globalId } = element;
    body =
      globalId === null ? (
        <PanelEmptyState icon={Info} message={t('messages.noGlobalId')} />
      ) : (
        <EntityFindingsBody
          projectId={projectId}
          scope={{ kind: 'element', modelId, fileId, globalId }}
          autoOpenNonce={autoOpenNonce}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      );
  } else {
    // Unreachable — the early states above cover this — but satisfies the type
    // checker's definite-assignment analysis for header/body.
    return <PanelEmptyState icon={Info} message={t('messages.noElementData')} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {isProjectMode ? (
        <OrphanedItemsNotice projectId={projectId} modelId={modelId} metadata={metadata} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
