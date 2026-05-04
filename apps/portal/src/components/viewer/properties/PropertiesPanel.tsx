'use client';

import { Info } from 'lucide-react';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { ElementEntry, ModelMetadata, ModelProperties } from '@/lib/api/viewerTypes';
import { useViewerEntityStore, parseEntityKey } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '../PanelEmptyState';
import { ElementHeader } from './ElementHeader';
import { PropertySetGroup } from './PropertySetGroup';

type PropertiesPanelProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
};

export function PropertiesPanel({
  metadata,
  properties,
  isLoadingProperties,
}: PropertiesPanelProps): JSX.Element {
  const selected = useViewerEntityStore((s) => s.selected);

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
    selectedElement.globalId && properties
      ? properties[selectedElement.globalId]
      : undefined;

  const psetEntries = elementProps ? Object.entries(elementProps) : [];

  return (
    <div className="flex h-full flex-col">
      <ElementHeader
        name={selectedElement.name}
        type={selectedElement.type}
        globalId={selectedElement.globalId}
      />
      {selected.size > 1 ? (
        <div className="flex items-center gap-1 border-b border-border px-3 py-1">
          <Badge>{String(selected.size)} selected</Badge>
          <span className="text-caption text-foreground-tertiary">
            Showing first element
          </span>
        </div>
      ) : null}

      {isLoadingProperties ? (
        <PanelEmptyState message="Loading properties..." />
      ) : psetEntries.length === 0 ? (
        <PanelEmptyState message="No property sets found for this element." />
      ) : (
        <div className="flex-1 overflow-auto">
          {psetEntries.map(([psetName, pset], idx) => (
            <PropertySetGroup
              key={psetName}
              name={psetName}
              properties={pset}
              defaultOpen={idx === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
