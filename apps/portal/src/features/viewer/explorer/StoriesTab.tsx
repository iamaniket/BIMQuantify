'use client';

import { Building } from 'lucide-react';
import { useMemo, type JSX } from 'react';

import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { TreeContainer } from './TreeContainer';
import { TreeNodeComponent, type TreeNodeData } from './TreeNode';
import {
  collectStoreys,
  elementToLeaf,
  groupElementsBy,
} from './treeBuilders';
import { useTreeExpansion } from './useTreeExpansion';

type StoriesTabProps = {
  spatialTree: SpatialNode | null;
  elements: ElementEntry[] | undefined;
};

export function StoriesTab({
  spatialTree,
  elements,
}: StoriesTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const { expanded, toggle } = useTreeExpansion();

  const storeyNodes = useMemo((): TreeNodeData[] => {
    if (!spatialTree || !elements || !modelId) return [];

    const storeys = collectStoreys(spatialTree);
    const grouped = groupElementsBy(elements, (el) => el.containedIn);

    return [...grouped.entries()].map(([storeyId, items]): TreeNodeData => {
      const storey = storeys.get(storeyId);
      const label = storey?.name ?? `Storey #${String(storeyId)}`;
      const children = items.map((el) => elementToLeaf(el, modelId, 'sty'));

      return {
        key: `storey-${String(storeyId)}`,
        label: `${label} (${String(items.length)})`,
        entityKeys: children.flatMap((c) => c.entityKeys),
        children,
      };
    });
  }, [spatialTree, elements, modelId]);

  if (storeyNodes.length === 0) {
    return <PanelEmptyState icon={Building} message="No storey data available." />;
  }

  return (
    <TreeContainer>
      {storeyNodes.map((node) => (
        <TreeNodeComponent
          key={node.key}
          node={node}
          depth={0}
          expanded={expanded}
          onToggleExpand={toggle}
        />
      ))}
    </TreeContainer>
  );
}
