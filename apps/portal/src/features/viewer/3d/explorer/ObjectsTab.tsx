'use client';

import { FolderOpen } from '@bimdossier/ui/icons';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import {
  buildObjectsRoots, collectNodeKeysToDepth, filterTree, collectAllKeys,
  type ExplorerModel,
} from './treeBuilders';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ObjectsTabProps = {
  models: ExplorerModel[];
};

export function ObjectsTab({ models }: ObjectsTabProps): JSX.Element {
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const selectAll = useViewerEntityStore((s) => s.selectAll);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const [filter, setFilter] = useState('');

  // One tree in single-file mode; one collapsible branch per model when many
  // are loaded. Keys are namespaced per model so federated trees never collide.
  const roots = useMemo(() => buildObjectsRoots(models), [models]);

  // Federated (many models): start fully collapsed so every model name shows as a
  // flat list. Single-file: expand the spatial skeleton (~2 levels) but stop before
  // storeys so their element lists stay collapsed on open.
  const defaultExpanded = useMemo(
    () => (models.length > 1 ? [] : collectNodeKeysToDepth(roots, 2)),
    [roots, models.length],
  );

  const allKeys = useMemo(() => collectAllKeys(roots), [roots]);

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

  const allEntityKeys = useMemo(() => roots.flatMap((r) => r.entityKeys), [roots]);

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

  const filtered = useMemo(() => filterTree(roots, filter), [roots, filter]);

  if (roots.length === 0) {
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
