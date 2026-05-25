'use client';

import { Layers } from 'lucide-react';
import { useMemo, type JSX } from 'react';

import type { ElementEntry } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { TreeContainer } from './TreeContainer';
import { TreeNodeComponent, type TreeNodeData } from './TreeNode';
import { elementToLeaf, groupElementsBy } from './treeBuilders';
import { useTreeExpansion } from './useTreeExpansion';

type ClassesTabProps = {
  elements: ElementEntry[] | undefined;
};

export function ClassesTab({ elements }: ClassesTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const { expanded, toggle } = useTreeExpansion();

  const classNodes = useMemo((): TreeNodeData[] => {
    if (!elements || !modelId) return [];

    const grouped = groupElementsBy(elements, (el) => el.type);

    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => {
        const children = items.map((el) => elementToLeaf(el, modelId, 'cls'));
        return {
          key: `class-${type}`,
          label: `${type} (${String(items.length)})`,
          entityKeys: children.flatMap((c) => c.entityKeys),
          children,
        };
      });
  }, [elements, modelId]);

  if (classNodes.length === 0) {
    return <PanelEmptyState icon={Layers} message="No element data available." />;
  }

  return (
    <TreeContainer>
      {classNodes.map((node) => (
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
