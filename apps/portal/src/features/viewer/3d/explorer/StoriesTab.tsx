'use client';

import { Building } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import { buildMergedStoreyNodes, filterTree, type ExplorerModel } from './treeBuilders';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type StoriesTabProps = {
  models: ExplorerModel[];
};

export function StoriesTab({ models }: StoriesTabProps): JSX.Element {
  const t = useTranslations('viewer.explorer');
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const selectAll = useViewerEntityStore((s) => s.selectAll);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const [filter, setFilter] = useState('');

  // Storeys merged across models by name — the same level from every discipline
  // collapses into one node holding that level's elements from all models.
  const storeyNodes = useMemo(() => buildMergedStoreyNodes(models), [models]);

  const allKeys = useMemo(() => storeyNodes.map((n) => n.key), [storeyNodes]);

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

  const filtered = useMemo(() => filterTree(storeyNodes, filter), [storeyNodes, filter]);

  if (storeyNodes.length === 0) {
    return <PanelEmptyState icon={Building} message={t('noStoreyData')} />;
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
