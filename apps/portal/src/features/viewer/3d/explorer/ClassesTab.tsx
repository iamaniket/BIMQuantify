'use client';

import { Layers } from '@bimstitch/ui/icons';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import type { ElementEntry } from '@/lib/api/viewerTypes';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import type { TreeNodeData } from './TreeNode';
import { elementToLeaf, groupElementsBy, filterTree } from './treeBuilders';
import { ifcClassColor } from './ifcClassColors';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ClassesTabProps = {
  elements: ElementEntry[] | undefined;
};

export function ClassesTab({
  elements,
}: ClassesTabProps): JSX.Element {
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

  const classNodes = useMemo((): TreeNodeData[] => {
    if (!elements || !modelId) return [];

    const grouped = groupElementsBy(elements, (el) => el.type);

    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => {
        const children = items.map((el) => elementToLeaf(el, modelId, 'cls'));
        return {
          key: `class-${type}`,
          label: type,
          entityKeys: children.flatMap((c) => c.entityKeys),
          children,
          count: items.length,
          color: ifcClassColor(type),
          mono: true,
        };
      });
  }, [elements, modelId]);

  const allKeys = useMemo(
    () => classNodes.map((n) => n.key),
    [classNodes],
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
    () => classNodes.flatMap((n) => n.entityKeys),
    [classNodes],
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

  const filtered = useMemo(() => filterTree(classNodes, filter), [classNodes, filter]);

  if (classNodes.length === 0) {
    return <PanelEmptyState icon={Layers} message="No element data available." />;
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
