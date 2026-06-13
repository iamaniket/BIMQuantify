import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { toEntityKey } from '@/stores/viewerEntityStore';

import { ifcClassColor } from './ifcClassColors';
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
    // The key namespaces by modelId so a federated scene (multiple models that
    // can share expressIDs) never produces duplicate tree-node keys.
    key: `${keyPrefix}-${modelId}-${String(el.expressID)}`,
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

/**
 * Return a copy of the spatial tree with every IfcSpace node removed, hoisting
 * any of its children up to the parent. Spaces are excluded from the explorer
 * listings — their visibility is controlled solely by the toolbar toggle.
 */
export function pruneSpaceNodes(node: SpatialNode): SpatialNode {
  const children: SpatialNode[] = [];
  for (const child of node.children) {
    const pruned = pruneSpaceNodes(child);
    if (child.type === 'IfcSpace') {
      children.push(...pruned.children);
    } else {
      children.push(pruned);
    }
  }
  return { ...node, children };
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

// ── Federated (multi-model) explorer builders ───────────────────────────────
// The single-file tabs read one model's metadata + the viewer's `store.modelId`.
// In a federated scene the explorer spans every loaded model, so these builders
// take an explicit list of models and namespace every node key by the model's
// viewer id (models can share expressIDs → keys would otherwise collide).

/** One loaded model's data for the explorer, already pruned of IfcSpace nodes. */
export type ExplorerModel = {
  /** Viewer scene model id (`file-<fileId>`) baked into the element keys. */
  viewerModelId: string;
  modelName: string;
  spatialTree: SpatialNode | null;
  elements: ElementEntry[];
};

// Build an element node, recursively nesting any element decomposed from it
// (e.g. IfcMember/IfcPlate under a curtain wall). `placed` guards re-attaching
// an element an ancestor already claimed.
function buildElementNode(
  el: ElementEntry,
  elementsByContainer: Map<number, ElementEntry[]>,
  modelId: string,
  placed: Set<number>,
): TreeNodeData {
  placed.add(el.expressID);
  const leaf = elementToLeaf(el, modelId, 'obj');
  const childEls = (elementsByContainer.get(el.expressID) ?? [])
    .filter((c) => !placed.has(c.expressID))
    .map((c) => buildElementNode(c, elementsByContainer, modelId, placed));
  if (childEls.length === 0) return leaf;
  const childKeys = childEls.flatMap((c) => c.entityKeys);
  return {
    ...leaf,
    entityKeys: [...leaf.entityKeys, ...childKeys],
    count: childKeys.length,
    children: childEls,
  };
}

function buildSpatialNode(
  node: SpatialNode,
  elementsByContainer: Map<number, ElementEntry[]>,
  modelId: string,
  placed: Set<number>,
): TreeNodeData {
  const childNodes = node.children.map(
    (c) => buildSpatialNode(c, elementsByContainer, modelId, placed),
  );
  const elementNodes = (elementsByContainer.get(node.expressID) ?? [])
    .filter((el) => !placed.has(el.expressID))
    .map((el) => buildElementNode(el, elementsByContainer, modelId, placed));
  const allChildren = [...childNodes, ...elementNodes];
  const count = allChildren.reduce((s, c) => s + c.entityKeys.length, 0);
  const result: TreeNodeData = {
    key: `sp-${modelId}-${String(node.expressID)}`,
    label: node.name ?? node.type,
    type: node.type,
    entityKeys: allChildren.flatMap((c) => c.entityKeys),
    ...(count > 0 ? { count } : {}),
  };
  if (allChildren.length > 0) result.children = allChildren;
  return result;
}

/** One model's spatial object tree (null when it has no spatial structure). */
export function buildModelObjectsTree(model: ExplorerModel): TreeNodeData | null {
  const { spatialTree, elements, viewerModelId } = model;
  if (!spatialTree) return null;
  const spatialIDs = collectSpatialExpressIDs(spatialTree);
  const elementsByContainer = groupElementsBy(
    elements.filter((el) => !spatialIDs.has(el.expressID)),
    (el) => el.containedIn,
  );
  const placed = new Set<number>();
  const root = buildSpatialNode(spatialTree, elementsByContainer, viewerModelId, placed);

  // Surface elements whose container never resolved into the tree so nothing is
  // silently hidden.
  const orphanNodes: TreeNodeData[] = [];
  for (const el of elements) {
    if (spatialIDs.has(el.expressID) || placed.has(el.expressID)) continue;
    orphanNodes.push(buildElementNode(el, elementsByContainer, viewerModelId, placed));
  }
  if (orphanNodes.length > 0) {
    const merged = [...(root.children ?? []), ...orphanNodes];
    root.children = merged;
    root.entityKeys = merged.flatMap((c) => c.entityKeys);
    root.count = root.entityKeys.length;
  }
  return root;
}

/**
 * Objects-tab roots. One model → its tree directly (single-file behaviour).
 * Many models → one collapsible branch per model, labelled by model name.
 */
export function buildObjectsRoots(models: ExplorerModel[]): TreeNodeData[] {
  if (models.length === 1) {
    const root = buildModelObjectsTree(models[0]!);
    return root ? [root] : [];
  }
  const roots: TreeNodeData[] = [];
  for (const m of models) {
    const tree = buildModelObjectsTree(m);
    if (!tree) continue;
    roots.push({
      key: `model-${m.viewerModelId}`,
      label: m.modelName.length > 0 ? m.modelName : tree.label,
      type: 'model',
      entityKeys: tree.entityKeys,
      children: tree.children ?? [tree],
      ...(tree.count !== undefined ? { count: tree.count } : {}),
    });
  }
  return roots;
}

/** Classes tab — group every loaded model's elements by IFC class. */
export function buildCombinedClassNodes(models: ExplorerModel[]): TreeNodeData[] {
  const byType = new Map<string, TreeNodeData[]>();
  for (const m of models) {
    for (const el of m.elements) {
      let arr = byType.get(el.type);
      if (!arr) {
        arr = [];
        byType.set(el.type, arr);
      }
      arr.push(elementToLeaf(el, m.viewerModelId, 'cls'));
    }
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, children]) => ({
      key: `class-${type}`,
      label: type,
      entityKeys: children.flatMap((c) => c.entityKeys),
      children,
      count: children.length,
      color: ifcClassColor(type),
      mono: true,
    }));
}

/**
 * Stories tab — merge storeys across models by name: the same level present in
 * the architectural, structural and MEP models collapses into one node holding
 * that level's elements from every model. Unnamed storeys stay per-model.
 */
export function buildMergedStoreyNodes(models: ExplorerModel[]): TreeNodeData[] {
  const byLevel = new Map<string, { label: string; children: TreeNodeData[] }>();
  for (const m of models) {
    if (!m.spatialTree) continue;
    const storeys = collectStoreys(m.spatialTree);
    const grouped = groupElementsBy(m.elements, (el) => el.containedIn);
    for (const [storeyId, items] of grouped.entries()) {
      const storey = storeys.get(storeyId);
      const storeyName = storey ? storey.name : null;
      const label = storeyName ?? `Storey #${String(storeyId)}`;
      // Named storeys merge across models; unnamed ones stay model-unique.
      const levelKey = storeyName !== null && storeyName.trim().length > 0
        ? `name:${storeyName.trim().toLowerCase()}`
        : `id:${m.viewerModelId}:${String(storeyId)}`;
      let bucket = byLevel.get(levelKey);
      if (!bucket) {
        bucket = { label, children: [] };
        byLevel.set(levelKey, bucket);
      }
      for (const el of items) {
        bucket.children.push({
          ...elementToLeaf(el, m.viewerModelId, 'sty'),
          color: ifcClassColor(el.type),
        });
      }
    }
  }
  return [...byLevel.entries()].map(([levelKey, b]) => ({
    key: `storey-${levelKey}`,
    label: b.label,
    entityKeys: b.children.flatMap((c) => c.entityKeys),
    children: b.children,
    count: b.children.length,
  }));
}

/** Keys of expandable nodes from `roots` down to (and including) `maxDepth`. */
export function collectNodeKeysToDepth(
  roots: TreeNodeData[],
  maxDepth: number,
): string[] {
  const keys: string[] = [];
  const walk = (n: TreeNodeData, depth: number): void => {
    if (depth > maxDepth) return;
    if (n.children && n.children.length > 0) {
      keys.push(n.key);
      n.children.forEach((c) => { walk(c, depth + 1); });
    }
  };
  roots.forEach((r) => { walk(r, 0); });
  return keys;
}
