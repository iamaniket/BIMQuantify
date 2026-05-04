'use client';

import { FolderOpen } from 'lucide-react';
import { useMemo, type JSX } from 'react';

import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '../PanelEmptyState';
import { TreeContainer } from './TreeContainer';
import { TreeNodeComponent, type TreeNodeData } from './TreeNode';
import { elementToLeaf, groupElementsBy } from './treeBuilders';
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
  const childNodes = node.children.map((c) =>
    buildTree(c, elementsByContainer, modelId),
  );

  const elementNodes = (elementsByContainer.get(node.expressID) ?? []).map(
    (el) => elementToLeaf(el, modelId, 'obj'),
  );

  const allChildren = [...childNodes, ...elementNodes];

  const result: TreeNodeData = {
    key: `sp-${String(node.expressID)}`,
    label: node.name ?? node.type,
    type: node.type,
    entityKeys: allChildren.flatMap((c) => c.entityKeys),
  };
  if (allChildren.length > 0) result.children = allChildren;
  return result;
}

export function ObjectsTab({
  spatialTree,
  elements,
}: ObjectsTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const { expanded, toggle } = useTreeExpansion();

  const elementsByContainer = useMemo(
    () => groupElementsBy(elements ?? [], (el) => el.containedIn),
    [elements],
  );

  const tree = useMemo(() => {
    if (!spatialTree || !modelId) return null;
    return buildTree(spatialTree, elementsByContainer, modelId);
  }, [spatialTree, elementsByContainer, modelId]);

  if (!tree) {
    return <PanelEmptyState icon={FolderOpen} message="No spatial data available." />;
  }

  return (
    <TreeContainer>
      <TreeNodeComponent
        node={tree}
        depth={0}
        expanded={expanded}
        onToggleExpand={toggle}
      />
    </TreeContainer>
  );
}
