'use client';

import { History, Info } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import type { ElementEntry, ModelMetadata, ModelProperties } from '@/lib/api/viewerTypes';
import { useViewerEntityStore, parseEntityKey } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '../PanelEmptyState';
import { ViewerPanelTabs, type ViewerTabDef } from '../ViewerPanelTabs';
import { ElementHeader } from './ElementHeader';
import { PropertySetGroup } from './PropertySetGroup';

type PropertiesPanelProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
};

type PropertiesTab = 'properties' | 'history';

const TABS: ViewerTabDef<PropertiesTab>[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'history', label: 'History' },
];

export function PropertiesPanel({
  metadata,
  properties,
  isLoadingProperties,
}: PropertiesPanelProps): JSX.Element {
  const selected = useViewerEntityStore((s) => s.selected);
  const [tab, setTab] = useState<PropertiesTab>('properties');

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  const selectedElement = useMemo((): ElementEntry | null => {
    if (selected.size === 0) return null;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return null;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return null;
    return elementsByExpressId.get(parsed.localId) ?? null;
  }, [selected, elementsByExpressId]);

  if (selected.size === 0) {
    return (
      <PanelEmptyState
        icon={Info}
        message="Select an element in the viewer to inspect its properties."
      />
    );
  }

  if (!selectedElement) {
    return (
      <PanelEmptyState
        icon={Info}
        message="Element data not available. Re-extract the model to populate properties."
      />
    );
  }

  const elementProps =
    selectedElement.globalId !== null && properties
      ? properties[selectedElement.globalId]
      : undefined;

  const psetEntries = elementProps
    ? Object.entries(elementProps).filter(
        ([key, value]) =>
          key !== '_element_type' && typeof value === 'object' && value !== null,
      )
    : [];

  return (
    <div className="flex h-full flex-col">
      <ElementHeader
        name={selectedElement.name}
        type={selectedElement.type}
        globalId={selectedElement.globalId}
        selectionCount={selected.size}
      />
      <ViewerPanelTabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'properties' && (
          <>
            {isLoadingProperties ? (
              <PanelEmptyState message="Loading properties..." />
            ) : psetEntries.length === 0 ? (
              <PanelEmptyState message="No property sets found for this element." />
            ) : (
              psetEntries.map(([psetName, pset], idx) => (
                <PropertySetGroup
                  key={psetName}
                  name={psetName}
                  properties={pset}
                  defaultOpen={idx === 0}
                />
              ))
            )}
          </>
        )}
        {tab === 'history' && (
          <PanelEmptyState
            icon={History}
            message="Change history for this element will appear here."
          />
        )}
      </div>
    </div>
  );
}
