'use client';

import { Eyebrow } from '@bimstitch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/shared/PanelTabs';
import { useProjectAttachmentCount } from '@/features/attachments/useAttachments';
import { useProjectCertificateCount } from '@/features/certificates/useCertificates';
import { useProjectFindingCount } from '@/features/findings/useFindings';
import { ElementHeader } from '@/features/viewer/3d/properties/ElementHeader';
import { PdfAttachmentsBody } from '@/features/viewer/pdf/PdfAttachmentsBody';
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

export function EntityInspectorPanel(props: EntityInspectorPanelProps): JSX.Element {
  if (props.isPdf === true) {
    return <PdfInspector {...props} />;
  }
  return <IfcInspector {...props} />;
}

function IfcInspector({
  metadata,
  projectId,
  modelId,
  fileId,
  requestedView,
  requestNonce,
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

  const autoOpenNonce =
    requestedView !== undefined &&
    requestNonce !== undefined &&
    requestNonce !== consumedNonce
      ? requestNonce
      : undefined;

  const handleAutoOpenConsumed = () => setConsumedNonce(requestNonce);

  const {
    element,
    selectedAll,
    hasSelection,
    isMultiSelection,
  } = useSelectedElement(metadata);

  const isProjectMode = !hasSelection;

  const attachmentCount = useEntityAttachmentCount(
    projectId,
    modelId,
    element?.globalId ?? null,
  );
  const findingCount = useEntityFindingCount(
    projectId,
    modelId,
    element?.globalId ?? null,
  );
  const certificateCount = useEntityCertificateCount(
    projectId,
    modelId,
    element?.globalId ?? null,
  );
  const projectAttachmentCount = useProjectAttachmentCount(projectId, isProjectMode);
  const projectFindingCount = useProjectFindingCount(projectId, isProjectMode);
  const projectCertificateCount = useProjectCertificateCount(projectId, isProjectMode);

  if (selectedAll) {
    const storeTotalElements = useViewerEntityStore.getState().totalElements;
    const count = storeTotalElements > 0 ? storeTotalElements : (metadata?.totalElements ?? 0);
    return (
      <PanelEmptyState
        icon={Info}
        message={t('messages.allSelected', { count })}
      />
    );
  }

  if (isMultiSelection) {
    return (
      <PanelEmptyState
        icon={Info}
        message={tAttachments('emptyMultiSelection')}
      />
    );
  }

  const tabs: TabDef<Tab>[] = [
    {
      id: 'attachments',
      label: t('tabAttachments'),
      count: isProjectMode ? projectAttachmentCount : attachmentCount,
    },
    {
      id: 'findings',
      label: t('tabFindings'),
      count: isProjectMode ? projectFindingCount : findingCount,
    },
    {
      id: 'certificates',
      label: t('tabCertificates'),
      count: isProjectMode ? projectCertificateCount : certificateCount,
    },
  ];

  let header: JSX.Element;
  let body: JSX.Element;
  if (isProjectMode) {
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
          modelId={modelId}
          fileId={fileId}
          globalId={null}
          autoOpenNonce={requestedView === 'attachments' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : tab === 'findings' ? (
        <EntityFindingsBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          globalId={null}
          autoOpenNonce={requestedView === 'findings' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : (
        <EntityCertificatesBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          globalId={null}
          autoOpenNonce={requestedView === 'certificates' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      );
  } else if (element !== null) {
    header = <ElementHeader name={element.name} type={element.type} />;
    body =
      element.globalId === null ? (
        <PanelEmptyState icon={Info} message={t('messages.noGlobalId')} />
      ) : tab === 'attachments' ? (
        <EntityAttachmentsBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          globalId={element.globalId}
          autoOpenNonce={requestedView === 'attachments' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : tab === 'findings' ? (
        <EntityFindingsBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          globalId={element.globalId}
          autoOpenNonce={requestedView === 'findings' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      ) : (
        <EntityCertificatesBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          globalId={element.globalId}
          autoOpenNonce={requestedView === 'certificates' ? autoOpenNonce : undefined}
          onAutoOpenConsumed={handleAutoOpenConsumed}
        />
      );
  } else {
    return (
      <PanelEmptyState icon={Info} message={t('messages.noElementData')} />
    );
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

function PdfInspector({
  projectId,
  modelId,
  fileId,
  pdfCurrentPage,
  pdfPinMode,
  onPdfPinModeChange,
}: EntityInspectorPanelProps): JSX.Element {
  const t = useTranslations('viewerInspector');

  if (
    pdfCurrentPage === undefined
    || pdfPinMode === undefined
    || onPdfPinModeChange === undefined
  ) {
    return (
      <PanelEmptyState
        icon={Info}
        message={t('messages.pdfNotInitialized')}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-surface-main px-3.5 pb-2.5 pt-3">
        <div className="flex items-center gap-2 font-sans text-caption uppercase tracking-[0.12em] text-foreground-tertiary">
          <Eyebrow className="tracking-[0.12em]">PDF</Eyebrow>
          <span className="rounded-xs bg-primary-light px-1.5 py-px font-bold tracking-[0.08em] text-primary">
            {t('pdfPageHeader', { page: pdfCurrentPage })}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PdfAttachmentsBody
          projectId={projectId}
          modelId={modelId}
          fileId={fileId}
          pdfCurrentPage={pdfCurrentPage}
          pdfPinMode={pdfPinMode}
          onPdfPinModeChange={onPdfPinModeChange}
        />
      </div>
    </div>
  );
}
