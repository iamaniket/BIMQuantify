'use client';

import { Box } from 'lucide-react';
import { useState, type JSX } from 'react';

import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { PanelEmptyState } from '../PanelEmptyState';
import { ViewerPanelTabs, type ViewerTabDef } from '../ViewerPanelTabs';
import { ClassesTab } from './ClassesTab';
import { ObjectsTab } from './ObjectsTab';
import { StoriesTab } from './StoriesTab';

type ModelExplorerProps = {
  metadata: ModelMetadata | undefined;
  isLoading: boolean;
};

type ExplorerTab = 'objects' | 'classes' | 'stories';

const TABS: ViewerTabDef<ExplorerTab>[] = [
  { id: 'objects', label: 'Objects' },
  { id: 'classes', label: 'Classes' },
  { id: 'stories', label: 'Stories' },
];

export function ModelExplorer({
  metadata,
  isLoading,
}: ModelExplorerProps): JSX.Element {
  const [tab, setTab] = useState<ExplorerTab>('objects');

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
      <ViewerPanelTabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'objects' && (
          <ObjectsTab spatialTree={metadata.spatialTree} elements={metadata.elements} />
        )}
        {tab === 'classes' && <ClassesTab elements={metadata.elements} />}
        {tab === 'stories' && (
          <StoriesTab spatialTree={metadata.spatialTree} elements={metadata.elements} />
        )}
      </div>
    </div>
  );
}
