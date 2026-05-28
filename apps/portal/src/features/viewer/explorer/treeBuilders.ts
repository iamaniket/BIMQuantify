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
    if (k === null) {
      // skip elements without a group key
    } else {
      let arr = map.get(k);
      if (!arr) {
        arr = [];
        map.set(k, arr);
      }
      arr.push(el);
    }
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

export function filterTree(
  nodes: TreeNodeData[],
  query: string,
): TreeNodeData[] {
  if (!query.trim()) return nodes;
  const needle = query.toLowerCase();
  const walk = (n: TreeNodeData): TreeNodeData | null => {
    const hit = n.label.toLowerCase().includes(needle);
    const kids = n.children
      ? (n.children.map(walk).filter(Boolean) as TreeNodeData[])
      : null;
    if (hit || (kids && kids.length > 0)) {
      return kids ? { ...n, children: kids } : { ...n };
    }
    return null;
  };
  return nodes.map(walk).filter(Boolean) as TreeNodeData[];
}

export function collectSpatialExpressIDs(node: SpatialNode): Set<number> {
  const ids = new Set<number>([node.expressID]);
  for (const child of node.children) {
    for (const id of collectSpatialExpressIDs(child)) {
      ids.add(id);
    }
  }
  return ids;
}

export function collectAllKeys(nodes: TreeNodeData[]): string[] {
  const keys: string[] = [];
  const walk = (n: TreeNodeData): void => {
    if (n.children && n.children.length > 0) {
      keys.push(n.key);
      n.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return keys;
}

/** Collect spatial-tree node keys down to `maxDepth` levels (0 = root only). */
export function collectExpandedKeys(
  node: SpatialNode,
  maxDepth: number,
  depth = 0,
): string[] {
  if (depth > maxDepth) return [];
  const key = `sp-${String(node.expressID)}`;
  const childKeys = node.children.flatMap(
    (c) => collectExpandedKeys(c, maxDepth, depth + 1),
  );
  return [key, ...childKeys];
}
