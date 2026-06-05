'use client';

import { FolderOpen } from '@bimstitch/ui/icons';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import type { TreeNodeData } from './TreeNode';
import {
  elementToLeaf, groupElementsBy, filterTree, collectExpandedKeys,
  collectSpatialExpressIDs, collectAllKeys,
} from './treeBuilders';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ObjectsTabProps = {
  spatialTree: SpatialNode | null;
  elements: ElementEntry[] | undefined;
};

// Build an element node, recursively nesting any element decomposed from it
// (e.g. IfcMember/IfcPlate under a curtain wall, IfcBuildingElementPart under
// an assembly). `placed` guards against re-attaching an element that an
// ancestor already claimed.
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

function buildTree(
  node: SpatialNode,
  elementsByContainer: Map<number, ElementEntry[]>,
  modelId: string,
  placed: Set<number>,
): TreeNodeData {
  const childNodes = node.children.map(
    (c) => buildTree(c, elementsByContainer, modelId, placed),
  );

  const elementNodes = (elementsByContainer.get(node.expressID) ?? [])
    .filter((el) => !placed.has(el.expressID))
    .map((el) => buildElementNode(el, elementsByContainer, modelId, placed));

  const allChildren = [...childNodes, ...elementNodes];
  const count = allChildren.reduce((s, c) => s + (c.entityKeys.length), 0);

  const result: TreeNodeData = {
    key: `sp-${String(node.expressID)}`,
    label: node.name ?? node.type,
    type: node.type,
    entityKeys: allChildren.flatMap((c) => c.entityKeys),
    ...(count > 0 ? { count } : {}),
  };
  if (allChildren.length > 0) result.children = allChildren;
  return result;
}

export function ObjectsTab({
  spatialTree,
  elements,
}: ObjectsTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const select = useViewerEntityStore((s) => s.select);
  const selectAll = useViewerEntityStore((s) => s.selectAll);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const [filter, setFilter] = useState('');

  const spatialIDs = useMemo(
    () => (spatialTree ? collectSpatialExpressIDs(spatialTree) : new Set<number>()),
    [spatialTree],
  );

  const elementsByContainer = useMemo(
    () => groupElementsBy(
      (elements ?? []).filter((el) => !spatialIDs.has(el.expressID)),
      (el) => el.containedIn,
    ),
    [elements, spatialIDs],
  );

  const tree = useMemo(() => {
    if (!spatialTree || !modelId) return null;
    const placed = new Set<number>();
    const root = buildTree(spatialTree, elementsByContainer, modelId, placed);

    // Elements whose containedIn never resolves to a node in the tree (null
    // container, or a parent outside the spatial structure) would otherwise
    // vanish — surface them under the root so nothing is silently hidden.
    const orphanNodes: TreeNodeData[] = [];
    for (const el of elements ?? []) {
      if (spatialIDs.has(el.expressID) || placed.has(el.expressID)) continue;
      orphanNodes.push(buildElementNode(el, elementsByContainer, modelId, placed));
    }
    if (orphanNodes.length > 0) {
      const merged = [...(root.children ?? []), ...orphanNodes];
      root.children = merged;
      root.entityKeys = merged.flatMap((c) => c.entityKeys);
      root.count = root.entityKeys.length;
    }
    return root;
  }, [spatialTree, elementsByContainer, modelId, elements, spatialIDs]);

  const defaultExpanded = useMemo(() => {
    if (spatialTree == null) return [];
    // Expand the spatial skeleton (project → site → building) but stop before
    // storeys so their element lists stay collapsed on open.
    return collectExpandedKeys(spatialTree, 2);
  }, [spatialTree]);

  const allKeys = useMemo(() => (tree ? collectAllKeys([tree]) : []), [tree]);

  const {
    expanded, toggle, expandAll, collapseAll, isAllExpanded,
  } = useTreeExpansion(defaultExpanded);

  const allExpanded = isAllExpanded(allKeys);

  const handleToggleExpand = useCallback(() => {
    if (allExpanded) {
      collapseAll();
    } else {
      expandAll(allKeys);
    }
  }, [allExpanded, collapseAll, expandAll, allKeys]);

  const allEntityKeys = useMemo(() => {
    if (tree == null) return [];
    return tree.entityKeys;
  }, [tree]);

  const allChecked = useMemo(
    () => allEntityKeys.length > 0 && allEntityKeys.every((k) => !hidden.has(k)),
    [allEntityKeys, hidden],
  );

  const handleToggleCheckAll = useCallback(() => {
    if (allEntityKeys.length === 0) return;
    if (allChecked) {
      hideItems(allEntityKeys);
    } else {
      showItems(allEntityKeys);
    }
  }, [allChecked, showItems, hideItems, allEntityKeys]);

  const allSelected = useMemo(
    () => selectedAll || (allEntityKeys.length > 0 && allEntityKeys.every((k) => selected.has(k))),
    [selectedAll, allEntityKeys, selected],
  );

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll();
    }
  }, [allSelected, clearSelection, selectAll]);

  const filtered = useMemo(
    () => (tree ? filterTree([tree], filter) : []),
    [tree, filter],
  );

  if (!tree) {
    return <PanelEmptyState icon={FolderOpen} message="No spatial data available." />;
  }

  return (
    <>
      <TreeToolbar
        query={filter}
        onQueryChange={setFilter}
        isAllExpanded={allExpanded}
        onToggleExpand={handleToggleExpand}
        allChecked={allChecked}
        onToggleCheckAll={handleToggleCheckAll}
        allSelected={allSelected}
        onToggleSelectAll={handleToggleSelectAll}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <VirtualizedTree
          roots={filtered}
          expanded={expanded}
          onToggleExpand={toggle}
        />
      </div>
    </>
  );
}
