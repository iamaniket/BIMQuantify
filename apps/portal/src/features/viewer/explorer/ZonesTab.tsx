'use client';

import { Boxes } from 'lucide-react';
import {
  useState, useMemo, useCallback, type JSX,
} from 'react';

import type { ZoneNode } from '@/lib/api/viewerTypes';
import { useViewerEntityStore, toEntityKey } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { VirtualizedTree } from './VirtualizedTree';
import type { TreeNodeData } from './TreeNode';
import { filterTree } from './treeBuilders';
import { ifcClassColor } from './ifcClassColors';
import { TreeToolbar } from './TreeToolbar';
import { useTreeExpansion } from './useTreeExpansion';

type ZonesTabProps = {
  zones: ZoneNode[] | undefined;
};

export function ZonesTab({
  zones,
}: ZonesTabProps): JSX.Element {
  const modelId = useViewerEntityStore((s) => s.modelId);
  const showItems = useViewerEntityStore((s) => s.showItems);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const hidden = useViewerEntityStore((s) => s.hidden);
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const select = useViewerEntityStore((s) => s.select);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const [filter, setFilter] = useState('');

  const zoneNodes = useMemo((): TreeNodeData[] => {
    if (!zones || !modelId) return [];

    return zones.map((zone): TreeNodeData => {
      const spaceNodes = zone.spaces.map((space): TreeNodeData => ({
        key: `zone-${String(zone.expressID)}-space-${String(space.expressID)}`,
        label: space.name ?? `Space #${String(space.expressID)}`,
        type: 'IfcSpace',
        entityKeys: [toEntityKey(modelId, space.expressID)],
        color: ifcClassColor('IfcSpace'),
      }));

      const entityKeys = spaceNodes.flatMap((n) => n.entityKeys);
      return {
        key: `zone-${String(zone.expressID)}`,
        label: zone.name ?? `Zone #${String(zone.expressID)}`,
        entityKeys,
        children: spaceNodes,
        count: spaceNodes.length,
      };
    });
  }, [zones, modelId]);

  const allKeys = useMemo(
    () => zoneNodes.flatMap((n) => [n.key, ...(n.children ?? []).map((c) => c.key)]),
    [zoneNodes],
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
    () => zoneNodes.flatMap((n) => n.entityKeys),
    [zoneNodes],
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
    if (allEntityKeys.length === 0) return;
    if (allSelected) {
      clearSelection();
    } else {
      select(allEntityKeys);
    }
  }, [allSelected, clearSelection, select, allEntityKeys]);

  const filtered = useMemo(() => filterTree(zoneNodes, filter), [zoneNodes, filter]);

  if (zoneNodes.length === 0) {
    return <PanelEmptyState icon={Boxes} message="No zone data available." />;
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
