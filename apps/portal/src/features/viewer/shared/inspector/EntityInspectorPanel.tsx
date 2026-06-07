'use client';

import { Info } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { ContextLine } from '@/components/shared/viewer/shared/ContextLine';
import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/shared/PanelTabs';
import { usePdfFileAttachmentCount, useProjectAttachmentCount } from '@/features/attachments/useAttachments';
import { useFileCertificateCount, useProjectCertificateCount } from '@/features/certificates/useCertificates';
import { useFileFindingCount, useProjectFindingCount } from '@/features/findings/useFindings';
import { ElementHeader } from '@/features/viewer/3d/properties/ElementHeader';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { EntityAttachmentsBody, useEntityAttachmentCount } from './EntityAttachmentsBody';
import { EntityCertificatesBody, useEntityCertificateCount } from './EntityCertificatesBody';
import { EntityFindingsBody, useEntityFindingCount } from './EntityFindingsBody';
import { OrphanedItemsNotice } from './OrphanedItemsNotice';
import { useSelectedElement } from './useSelectedElement';

type Tab = 'attachments' | 'findings' | 'certificates';

type EntityInspectorPanelProps = {
  metadata: ModelMetadata | undefined;
  projectId: string;
  modelId: string;
  fileId: string;
  /** When set, the inspector switches to this tab. */
  requestedView?: Tab | undefined;
  /** Nonce that increments on each new request, so repeated requests re-fire. */
  requestNonce?: number | undefined;
  isPdf?: boolean;
  pdfCurrentPage?: number;
  pdfPinMode?: boolean;
  onPdfPinModeChange?: (enabled: boolean) => void;
};

/**
 * The viewer inspector — a single shared panel for both the 3D IFC viewer and
 * the 2D PDF viewer. The header (ContextLine), tab bar (Attachments / Findings
 * / Certificates) and bodies are identical across modes; only how each tab is
 * *scoped* differs: 3D scopes by selected element (or project when nothing is
 * selected); PDF scopes attachments by page (pin-linked) and findings /
 * certificates by the open file.
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
  pdfPinMode,
  onPdfPinModeChange,
}: EntityInspectorPanelProps): JSX.Element {
  const t = useTranslations('viewerInspector');
  const tAttachments = useTranslations('viewerAttachments');
  const [tab, setTab] = useState<Tab>('attachments');
  const [consumedNonce, setConsumedNonce] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (requestedView !== undefined && requestNonce !== undefined) {
      setTab(requestedView);
      // A new external trigger resets the consumed state so the body can fire once.
      setConsumedNonce(undefined);
    }
  }, [requestedView, requestNonce]);

  // Force the Attachments tab when PDF pin mode turns on, so the attachments
  // body is the mounted tab that consumes the dropped-pin handoff.
  const prevPinMode = useRef(false);
  useEffect(() => {
    if (isPdf === true && pdfPinMode === true && !prevPinMode.current) {
      setTab('attachments');
    }
    prevPinMode.current = pdfPinMode === true;
  }, [isPdf, pdfPinMode]);

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
  const elementGlobalId = element?.globalId ?? null;
  const pdfFileId = isPdf === true ? fileId : null;

  // All count hooks are called unconditionally (Hooks rules); inapplicable ones
  // are disabled via their `enabled`/null args, so only the active scope fetches.
  const attachmentCount = useEntityAttachmentCount(projectId, modelId, elementGlobalId);
  const findingCount = useEntityFindingCount(projectId, modelId, elementGlobalId);
  const certificateCount = useEntityCertificateCount(projectId, modelId, elementGlobalId);
  const projectAttachmentCount = useProjectAttachmentCount(projectId, isProjectMode);
  const projectFindingCount = useProjectFindingCount(projectId, isProjectMode);
  const projectCertificateCount = useProjectCertificateCount(projectId, isProjectMode);
  const pdfAttachmentCount = usePdfFileAttachmentCount(projectId, pdfFileId);
  const fileFindingCount = useFileFindingCount(projectId, pdfFileId);
  const fileCertificateCount = useFileCertificateCount(projectId, pdfFileId);

  // --- Early states (after all hooks) ---
  if (isPdf === true) {
    if (pdfCurrentPage === undefined || pdfPinMode === undefined || onPdfPinModeChange === undefined) {
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

  // --- Per-tab counts for the active scope ---
  const attachTabCount = isPdf === true
    ? pdfAttachmentCount
    : isProjectMode ? projectAttachmentCount : attachmentCount;
  const findingTabCount = isPdf === true
    ? fileFindingCount
    : isProjectMode ? projectFindingCount : findingCount;
  const certTabCount = isPdf === true
    ? fileCertificateCount
    : isProjectMode ? projectCertificateCount : certificateCount;

  const tabs: TabDef<Tab>[] = [
    { id: 'attachments', label: t('tabAttachments'), count: attachTabCount },
    { id: 'findings', label: t('tabFindings'), count: findingTabCount },
    { id: 'certificates', label: t('tabCertificates'), count: certTabCount },
  ];

  // --- Header + body for the active scope ---
  let header: JSX.Element;
  let body: JSX.Element;

  if (isPdf === true && pdfCurrentPage !== undefined && pdfPinMode !== undefined && onPdfPinModeChange !== undefined) {
    header = <ContextLine tag="PDF" name={t('pdfPageHeader', { page: pdfCurrentPage })} />;
    body =
      tab === 'attachments' ? (
        <EntityAttachmentsBody
          projectId={projectId}
          scope={{
            kind: 'pdf-page',
            fileId,
            modelId,
            page: pdfCurrentPage,
            pinMode: pdfPinMode,
            onPinModeChange: onPdfPinModeChange,
          }}
          autoOpenNonce={requestedView === 'attachments' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : tab === 'findings' ? (
        <EntityFindingsBody
          projectId={projectId}
          scope={{ kind: 'file', fileId }}
          autoOpenNonce={requestedView === 'findings' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : (
        <EntityCertificatesBody
          projectId={projectId}
          scope={{ kind: 'file', fileId }}
          autoOpenNonce={requestedView === 'certificates' ? autoOpenNonce : undefined}
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
    body =
      tab === 'attachments' ? (
        <EntityAttachmentsBody
          projectId={projectId}
          scope={{ kind: 'project' }}
          autoOpenNonce={requestedView === 'attachments' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : tab === 'findings' ? (
        <EntityFindingsBody
          projectId={projectId}
          scope={{ kind: 'project' }}
          autoOpenNonce={requestedView === 'findings' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : (
        <EntityCertificatesBody
          projectId={projectId}
          scope={{ kind: 'project' }}
          autoOpenNonce={requestedView === 'certificates' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      );
  } else if (element !== null) {
    header = <ElementHeader name={element.name} type={element.type} />;
    const { globalId } = element;
    body =
      globalId === null ? (
        <PanelEmptyState icon={Info} message={t('messages.noGlobalId')} />
      ) : tab === 'attachments' ? (
        <EntityAttachmentsBody
          projectId={projectId}
          scope={{ kind: 'element', modelId, fileId, globalId }}
          autoOpenNonce={requestedView === 'attachments' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : tab === 'findings' ? (
        <EntityFindingsBody
          projectId={projectId}
          scope={{ kind: 'element', modelId, fileId, globalId }}
          autoOpenNonce={requestedView === 'findings' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : (
        <EntityCertificatesBody
          projectId={projectId}
          scope={{ kind: 'element', modelId, fileId, globalId }}
          autoOpenNonce={requestedView === 'certificates' ? autoOpenNonce : undefined}
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
      <PanelTabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
