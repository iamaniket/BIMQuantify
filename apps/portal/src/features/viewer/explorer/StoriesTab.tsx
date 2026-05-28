'use client';

import { Building } from 'lucide-react';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import type { ElementEntry, SpatialNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import type { TreeNodeData } from './TreeNode';
import {
  collectStoreys,
  elementToLeaf,
  groupElementsBy,
  filterTree,
} from './treeBuilders';
import { ifcClassColor } from './ifcClassColors';
import { TreeToolbar } from './TreeToolbar';
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
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const [filter, setFilter] = useState('');

  const storeyNodes = useMemo((): TreeNodeData[] => {
    if (!spatialTree || !elements || !modelId) return [];

    const storeys = collectStoreys(spatialTree);
    const grouped = groupElementsBy(elements, (el) => el.containedIn);

    return [...grouped.entries()].map(([storeyId, items]): TreeNodeData => {
      const storey = storeys.get(storeyId);
      const storeyName = storey != null ? storey.name : null;
      const label = storeyName ?? `Storey #${String(storeyId)}`;
      const children = items.map((el) => ({
        ...elementToLeaf(el, modelId, 'sty'),
        color: ifcClassColor(el.type),
      }));

      return {
        key: `storey-${String(storeyId)}`,
        label,
        entityKeys: children.flatMap((c) => c.entityKeys),
        children,
        count: items.length,
      };
    });
  }, [spatialTree, elements, modelId]);

  const allKeys = useMemo(
    () => storeyNodes.map((n) => n.key),
    [storeyNodes],
  );

  const {
    expanded, toggle, expandAll, collapseAll, isAllExpanded,
  } = useTreeExpansion();

  const allExpanded = isAllExpanded(allKeys);

  const handleToggleExpand = useCallback(() => {
    if (allExpanded) {
      collapseAll();
    } else {
      expandAll(allKeys);
    }
  }, [allExpanded, collapseAll, expandAll, allKeys]);

  const allEntityKeys = useMemo(
    () => storeyNodes.flatMap((n) => n.entityKeys),
    [storeyNodes],
  );

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

  const filtered = useMemo(() => filterTree(storeyNodes, filter), [storeyNodes, filter]);

  if (storeyNodes.length === 0) {
    return <PanelEmptyState icon={Building} message="No storey data available." />;
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
