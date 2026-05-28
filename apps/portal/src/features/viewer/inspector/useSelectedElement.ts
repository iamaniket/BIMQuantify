'use client';

import { useMemo } from 'react';

import type { ElementEntry, ModelMetadata } from '@/lib/api/viewerTypes';
import {
  parseEntityKey,
  useViewerEntityStore,
} from '@/stores/viewerEntityStore';

export type SelectedElementState = {
  element: ElementEntry | null;
  selectedAll: boolean;
  selectedSize: number;
  hasSelection: boolean;
  isMultiSelection: boolean;
};

export function useSelectedElement(
  metadata: ModelMetadata | undefined,
): SelectedElementState {
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  const element = useMemo((): ElementEntry | null => {
    if (selectedAll || selected.size !== 1) return null;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return null;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return null;
    return elementsByExpressId.get(parsed.localId) ?? null;
  }, [selected, selectedAll, elementsByExpressId]);

  return {
    element,
    selectedAll,
    selectedSize: selected.size,
    hasSelection: selectedAll || selected.size > 0,
    isMultiSelection: !selectedAll && selected.size > 1,
  };
}
