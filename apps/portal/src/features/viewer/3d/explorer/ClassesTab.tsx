'use client';

import { Layers } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import { buildCombinedClassNodes, filterTree, type ExplorerModel } from './treeBuilders';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ClassesTabProps = {
  models: ExplorerModel[];
};

export function ClassesTab({ models }: ClassesTabProps): JSX.Element {
  const t = useTranslations('viewer.explorer');
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const selectAll = useViewerEntityStore((s) => s.selectAll);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const [filter, setFilter] = useState('');

  // One node per IFC class, aggregating elements from every loaded model.
  const classNodes = useMemo(() => buildCombinedClassNodes(models), [models]);

  const allKeys = useMemo(() => classNodes.map((n) => n.key), [classNodes]);

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
    return <PanelEmptyState icon={Layers} message={t('noElementData')} />;
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
