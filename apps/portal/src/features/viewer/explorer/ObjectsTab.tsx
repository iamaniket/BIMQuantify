'use client';

import { FolderOpen } from 'lucide-react';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import type { TreeNodeData } from './TreeNode';
import {
  elementToLeaf, groupElementsBy, filterTree, collectExpandedKeys,
} from './treeBuilders';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ObjectsTabProps = {
  spatialTree: SpatialNode | null;
  elements: ElementEntry[] | undefined;
};

function buildTree(
  node: SpatialNode,
  elementsByContainer: Map<number, ElementEntry[]>,
  modelId: string,
): TreeNodeData {
  const childNodes = node.children.map(
    (c) => buildTree(c, elementsByContainer, modelId),
  );

  const elementNodes = (elementsByContainer.get(node.expressID) ?? []).map(
    (el) => elementToLeaf(el, modelId, 'obj'),
  );

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

function collectAllKeysFromSpatial(node: SpatialNode): string[] {
  const keys: string[] = [`sp-${String(node.expressID)}`];
  for (const child of node.children) {
    keys.push(...collectAllKeysFromSpatial(child));
  }
  return keys;
}

export function ObjectsTab({
  spatialTree,
  elements,
}: ObjectsTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const [filter, setFilter] = useState('');

  const elementsByContainer = useMemo(
    () => groupElementsBy(elements ?? [], (el) => el.containedIn),
    [elements],
  );

  const tree = useMemo(() => {
    if (!spatialTree || !modelId) return null;
    return buildTree(spatialTree, elementsByContainer, modelId);
  }, [spatialTree, elementsByContainer, modelId]);

  const defaultExpanded = useMemo(() => {
    if (spatialTree == null) return [];
    return collectExpandedKeys(spatialTree, 3);
  }, [spatialTree]);

  const allKeys = useMemo(() => {
    if (spatialTree == null) return [];
    return collectAllKeysFromSpatial(spatialTree);
  }, [spatialTree]);

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
