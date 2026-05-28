'use client';

import { Box } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/PanelTabs';
import { ClassesTab } from './ClassesTab';
import { ObjectsTab } from './ObjectsTab';
import { StoriesTab } from './StoriesTab';

type ModelExplorerProps = {
  metadata: ModelMetadata | undefined;
  isLoading: boolean;
};

type ExplorerTab = 'objects' | 'classes' | 'stories';

const TABS: TabDef<ExplorerTab>[] = [
  { id: 'objects', label: 'Model' },
  { id: 'classes', label: 'Classes' },
  { id: 'stories', label: 'Stories' },
];

function SelectedLabel(): JSX.Element {
  const count = useViewerEntityStore(
    (s) => {
      if (s.selectedAll) return 'all';
      return String(s.selected.size);
    },
  );
  return <>{count}</>;
}

export function ModelExplorer({
  metadata,
  isLoading,
}: ModelExplorerProps): JSX.Element {
  const t = useTranslations('viewer.explorer');
  const [tab, setTab] = useState<ExplorerTab>('objects');
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const hasSelection = useViewerEntityStore(
    (s) => s.selectedAll || s.selected.size > 0,
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
      <PanelTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'objects' && (
        <ObjectsTab
          spatialTree={metadata.spatialTree}
          elements={metadata.elements}
        />
      )}
      {tab === 'classes' && (
        <ClassesTab
          elements={metadata.elements}
        />
      )}
      {tab === 'stories' && (
        <StoriesTab
          spatialTree={metadata.spatialTree}
          elements={metadata.elements}
        />
      )}
      {hasSelection && (
        <div
          className="flex shrink-0 items-center justify-between border-t border-border px-3.5 py-2.5 font-mono text-xs tabular-nums"
          style={{ color: 'var(--fg-3)', background: 'var(--surface-low)' }}
        >
          <span>
            <span style={{ color: 'var(--fg-2)', fontWeight: 700 }}>
              {t('selected')}
              :
            </span>
            {' '}
            <SelectedLabel />
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="cursor-pointer border-none bg-transparent font-mono text-xs"
            style={{ color: 'var(--primary)' }}
          >
            {t('clear')}
          </button>
        </div>
      )}
    </div>
  );
}

export function ExplorerCounter({
  metadata,
}: {
  metadata: ModelMetadata | undefined;
}): JSX.Element {
  const hiddenCount = useViewerEntityStore((s) => s.hidden.size);
  const total = metadata != null ? metadata.totalElements : 0;
  const shown = Math.max(0, total - hiddenCount);

  return (
    <span className="font-mono text-[11.5px] tabular-nums text-white/65">
      {shown.toLocaleString()} / {total.toLocaleString()}
    </span>
  );
}
