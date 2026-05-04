import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { toEntityKey } from '@/stores/viewerEntityStore';

import type { TreeNodeData } from './TreeNode';

export function elementLabel(el: ElementEntry): string {
  return el.name ?? `#${String(el.expressID)}`;
}

export function elementToLeaf(
  el: ElementEntry,
  modelId: string,
  keyPrefix: string,
): TreeNodeData {
  return {
    key: `${keyPrefix}-${String(el.expressID)}`,
    label: elementLabel(el),
    type: el.type,
    entityKeys: [toEntityKey(modelId, el.expressID)],
  };
}

export function groupElementsBy<K extends string | number>(
  elements: ElementEntry[],
  getKey: (el: ElementEntry) => K | null,
): Map<K, ElementEntry[]> {
  const map = new Map<K, ElementEntry[]>();
  for (const el of elements) {
    const k = getKey(el);
    if (k === null) continue;
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(el);
  }
  return map;
}

export function collectStoreys(node: SpatialNode): Map<number, SpatialNode> {
  const map = new Map<number, SpatialNode>();
  if (node.type === 'IfcBuildingStorey') {
    map.set(node.expressID, node);
  }
  for (const child of node.children) {
    for (const [k, v] of collectStoreys(child)) {
      map.set(k, v);
    }
  }
  return map;
}
