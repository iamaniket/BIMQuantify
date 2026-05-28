'use client';

import { useMemo, type JSX } from 'react';

import type {
  ElementEntry,
  ModelMetadata,
  ModelProperties,
} from '@/lib/api/viewerTypes';
import {
  useViewerEntityStore,
  parseEntityKey,
} from '@/stores/viewerEntityStore';

type PropertiesCounterProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
};

/**
 * Renders "X / Y" in the SidePanel header, matching the ExplorerCounter pattern.
 * X = total properties across all psets for the selected element.
 */
export function PropertiesCounter({
  metadata,
  properties,
}: PropertiesCounterProps): JSX.Element {
  const selected = useViewerEntityStore((s) => s.selected);

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  const total = useMemo(() => {
    if (selected.size === 0) return 0;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return 0;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return 0;
    const el = elementsByExpressId.get(parsed.localId);
    if (!el?.globalId || !properties) return 0;
    const elProps = properties[el.globalId];
    if (!elProps) return 0;
    let count = 0;
    for (const [key, value] of Object.entries(elProps)) {
      if (key === '_element_type' || typeof value !== 'object' || value === null)
        continue;
      count += Object.keys(value).length;
    }
    return count;
  }, [selected, elementsByExpressId, properties]);

  return (
    <span className="font-mono text-[11.5px] tabular-nums text-white/65">
      {total > 0 ? total.toLocaleString() : '—'}
    </span>
  );
}
