'use client';

import { Box } from '@bimstitch/ui/icons';
import { useMemo, useState, type JSX } from 'react';

import type { ModelMetadata, ModelProperties } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/shared/PanelTabs';
import { ClassesTab } from './ClassesTab';
import { ObjectsTab } from './ObjectsTab';
import { PropertiesSubPanel } from './PropertiesSubPanel';
import { StoriesTab } from './StoriesTab';
import { pruneSpaceNodes } from './treeBuilders';

type ModelExplorerProps = {
  metadata: ModelMetadata | undefined;
  isLoading: boolean;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
  isLoadingMetadata?: boolean;
  propertiesExpanded: boolean;
  onPropertiesToggle: () => void;
  modelTreeExpanded: boolean;
};

type ExplorerTab = 'objects' | 'classes' | 'stories';

const TABS: TabDef<ExplorerTab>[] = [
  { id: 'objects', label: 'Model' },
  { id: 'classes', label: 'Classes' },
  { id: 'stories', label: 'Stories' },
];

export function ModelExplorer({
  metadata,
  isLoading,
  properties,
  isLoadingProperties,
  isLoadingMetadata,
  propertiesExpanded,
  onPropertiesToggle,
  modelTreeExpanded,
}: ModelExplorerProps): JSX.Element {
  const [tab, setTab] = useState<ExplorerTab>('objects');

  // Spaces (IfcSpace) are excluded from every listing — their visibility is
  // controlled only by the toolbar toggle.
  const elementsNoSpaces = useMemo(
    () => (metadata?.elements ?? []).filter((el) => el.type !== 'IfcSpace'),
    [metadata?.elements],
  );
  const treeNoSpaces = useMemo(
    () => (metadata?.spatialTree ? pruneSpaceNodes(metadata.spatialTree) : null),
    [metadata?.spatialTree],
  );

  if (isLoading) {
    return <PanelEmptyState message="Loading model data..." />;
  }

  if (!metadata) {
    return (
      <PanelEmptyState
        icon={Box}
        message="No metadata available for this model."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {modelTreeExpanded && (
        <>
          <PanelTabs tabs={TABS} active={tab} onChange={setTab} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === 'objects' && (
              <ObjectsTab
                spatialTree={treeNoSpaces}
                elements={elementsNoSpaces}
              />
            )}
            {tab === 'classes' && (
              <ClassesTab
                elements={elementsNoSpaces}
              />
            )}
            {tab === 'stories' && (
              <StoriesTab
                spatialTree={treeNoSpaces}
                elements={elementsNoSpaces}
              />
            )}
          </div>
        </>
      )}
      <PropertiesSubPanel
        metadata={metadata}
        properties={properties}
        isLoadingProperties={isLoadingProperties}
        isLoadingMetadata={isLoadingMetadata}
        expanded={propertiesExpanded}
        onToggle={onPropertiesToggle}
      />
    </div>
  );
}

export function ExplorerCounter({
  metadata,
}: {
  metadata: ModelMetadata | undefined;
}): JSX.Element {
  const hiddenCount = useViewerEntityStore((s) => s.hidden.size);
  const storeTotalElements = useViewerEntityStore((s) => s.totalElements);
  const total = storeTotalElements > 0 ? storeTotalElements : (metadata != null ? metadata.totalElements : 0);
  const shown = Math.max(0, total - hiddenCount);

  return (
    <span className="font-sans text-[11.5px] tabular-nums text-white/65">
      {shown.toLocaleString()} / {total.toLocaleString()}
    </span>
  );
}
