'use client';

import { Eyebrow } from '@bimstitch/ui';
import { Info, MousePointerClick } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/PanelTabs';
import { ElementHeader } from '@/features/viewer/properties/ElementHeader';
import type { ModelMetadata, ModelProperties } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { EntityAttachmentsBody, useEntityAttachmentCount } from './EntityAttachmentsBody';
import { EntityFindingsBody, useEntityFindingCount } from './EntityFindingsBody';
import { PdfAttachmentsBody } from './PdfAttachmentsBody';
import { PropertiesBody, countPsetProperties } from './PropertiesBody';
import { useSelectedElement } from './useSelectedElement';

type Tab = 'properties' | 'attachments' | 'findings';

type EntityInspectorPanelProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
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
  properties,
  isLoadingProperties,
  projectId,
  modelId,
  fileId,
  requestedView,
  requestNonce,
}: EntityInspectorPanelProps): JSX.Element {
  const t = useTranslations('viewerInspector');
  const tAttachments = useTranslations('viewerAttachments');
  const [tab, setTab] = useState<Tab>('properties');

  // When a new inspect:request arrives, switch to the requested tab.
  useEffect(() => {
    if (requestedView !== undefined && requestNonce !== undefined) {
      setTab(requestedView);
    }
  }, [requestedView, requestNonce]);

  // Derive an auto-open nonce only for create-flow tabs (attachments/findings).
  const autoOpenNonce =
    requestedView !== undefined
    && requestedView !== 'properties'
    && requestNonce !== undefined
      ? requestNonce
      : undefined;

  const {
    element,
    selectedAll,
    selectedSize,
    hasSelection,
    isMultiSelection,
  } = useSelectedElement(metadata);

  const attachmentCount = useEntityAttachmentCount(
    projectId,
    fileId,
    element?.globalId ?? null,
  );
  const findingCount = useEntityFindingCount(
    projectId,
    fileId,
    element?.globalId ?? null,
  );

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

  if (!hasSelection) {
    return (
      <PanelEmptyState
        icon={MousePointerClick}
        message={tAttachments('emptyNoSelection')}
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

  if (!element) {
    return (
      <PanelEmptyState
        icon={Info}
        message={t('messages.noElementData')}
      />
    );
  }

  const propertiesCount = countPsetProperties(element, properties);

  const tabs: TabDef<Tab>[] = [
    { id: 'properties', label: t('tabProperties'), count: propertiesCount },
    { id: 'attachments', label: t('tabAttachments'), count: attachmentCount },
    { id: 'findings', label: t('tabFindings'), count: findingCount },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ElementHeader
        name={element.name}
        type={element.type}
      />
      <PanelTabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'properties' ? (
          <PropertiesBody
            element={element}
            properties={properties}
            isLoading={isLoadingProperties}
          />
        ) : element.globalId === null ? (
          <PanelEmptyState
            icon={Info}
            message={t('messages.noGlobalId')}
          />
        ) : tab === 'attachments' ? (
          <EntityAttachmentsBody
            projectId={projectId}
            modelId={modelId}
            fileId={fileId}
            globalId={element.globalId}
            autoOpenNonce={autoOpenNonce}
          />
        ) : (
          <EntityFindingsBody
            projectId={projectId}
            fileId={fileId}
            globalId={element.globalId}
            autoOpenNonce={autoOpenNonce}
          />
        )}
      </div>
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
