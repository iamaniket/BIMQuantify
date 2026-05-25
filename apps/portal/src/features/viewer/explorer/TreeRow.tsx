'use client';

import {
  Building2,
  BoxSelect,
  ChevronRight,
  Component,
  FolderKanban,
  Layers,
  MapPin,
} from 'lucide-react';
import { type CSSProperties, type JSX, useCallback, useRef, useEffect, memo } from 'react';

import { cn } from '@bimstitch/ui';
import { useShallow } from 'zustand/react/shallow';

import { useViewerEntityStore, type EntityKey } from '@/stores/viewerEntityStore';

import type { TreeNodeData } from './TreeNode';

const TYPE_ICON_MAP: Record<string, typeof Component> = {
  IfcProject: FolderKanban,
  IfcSite: MapPin,
  IfcBuilding: Building2,
  IfcBuildingStorey: Layers,
  IfcSpace: BoxSelect,
};

function typeIcon(type: string | undefined): typeof Component | null {
  if (!type) return null;
  return TYPE_ICON_MAP[type] ?? null;
}

type TreeCheckboxProps = {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClick: (e: React.MouseEvent) => void;
};

function TreeCheckbox({ checked, indeterminate, onChange, onClick }: TreeCheckboxProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={onClick}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-primary"
    />
  );
}

type TreeRowProps = {
  style: CSSProperties;
  node: TreeNodeData;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
};

function TreeRowInner({
  style,
  node,
  depth,
  expanded,
  onToggleExpand,
}: TreeRowProps): JSX.Element {
  const isExpanded = expanded.has(node.key);
  const hasChildren = (node.children?.length ?? 0) > 0;

  const { isSelected, hiddenCount } = useViewerEntityStore(
    useShallow((s) => {
      const isSelected =
        s.selectedAll || node.entityKeys.some((k) => s.selected.has(k));
      let hiddenCount = 0;
      for (const k of node.entityKeys) {
        if (s.hidden.has(k)) hiddenCount++;
      }
      return { isSelected, hiddenCount };
    }),
  );
  const totalKeys = node.entityKeys.length;
  const allHidden = totalKeys > 0 && hiddenCount === totalKeys;
  const someHidden = hiddenCount > 0 && hiddenCount < totalKeys;
  const isChecked = totalKeys > 0 && !allHidden;

  const select = useViewerEntityStore((s) => s.select);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const showItems = useViewerEntityStore((s) => s.showItems);

  const handleRowClick = useCallback(() => {
    if (node.entityKeys.length > 0) {
      select(node.entityKeys);
    }
  }, [node.entityKeys, select]);

  const handleCheckboxChange = useCallback(() => {
    if (node.entityKeys.length === 0) return;
    if (allHidden || someHidden) {
      showItems(node.entityKeys);
    } else {
      hideItems(node.entityKeys);
    }
  }, [node.entityKeys, allHidden, someHidden, showItems, hideItems]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(node.key);
    },
    [node.key, onToggleExpand],
  );

  const Icon = typeIcon(node.type);

  return (
    <div style={style}>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        className={cn(
          'group flex h-full items-center gap-1.5 pr-2 cursor-pointer select-none',
          'hover:bg-background-secondary rounded',
          isSelected && 'bg-primary/10',
          allHidden && 'opacity-40',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={handleRowClick}
      >
        <button
          type="button"
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded',
            hasChildren ? 'hover:bg-background-tertiary' : 'invisible',
          )}
          onClick={handleExpand}
          tabIndex={-1}
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 transition-transform duration-150',
              isExpanded && 'rotate-90',
            )}
          />
        </button>

        {totalKeys > 0 && (
          <TreeCheckbox
            checked={isChecked}
            indeterminate={someHidden}
            onChange={handleCheckboxChange}
            onClick={handleCheckboxClick}
          />
        )}

        {Icon != null && (
          <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
        )}

        <span
          className="flex-1 truncate text-caption"
          title={node.label}
        >
          {node.label}
        </span>
      </div>
    </div>
  );
}

export const TreeRow = memo(TreeRowInner);
