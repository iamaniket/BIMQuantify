'use client';

import {
  type CSSProperties,
  type JSX,
  type MouseEvent,
  useCallback,
  useRef,
  memo,
} from 'react';
import { useTranslations } from 'next-intl';

import { cn, CountChip } from '@bimstitch/ui';
import { useShallow } from 'zustand/react/shallow';

import { useViewerEntityStore, type EntityKey } from '@/stores/viewerEntityStore';

import type { TreeNodeData } from './TreeNode';
import { TriCheckbox, type CheckState } from './TriCheckbox';

function computeCheckState(
  entityKeys: EntityKey[],
  hidden: Set<EntityKey>,
): CheckState {
  if (entityKeys.length === 0) return 'on';
  let hiddenCount = 0;
  for (const k of entityKeys) {
    if (hidden.has(k)) hiddenCount += 1;
  }
  if (hiddenCount === 0) return 'on';
  if (hiddenCount === entityKeys.length) return 'off';
  return 'mixed';
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
  const t = useTranslations('viewer.explorer');
  const isExpanded = expanded.has(node.key);
  const hasChildren = node.children != null && node.children.length > 0;
  const leftPad = 8 + depth * 16;

  const { selected: isRowSelected, check: rowCheckState, isRowIsolated } = useViewerEntityStore(
    useShallow((s) => {
      const selected = s.selectedAll || node.entityKeys.some((k) => s.selected.has(k));
      const check = computeCheckState(node.entityKeys, s.hidden);
      const isIso = s.isolationActive
        && node.entityKeys.length > 0
        && node.entityKeys.length === s.isolated.size
        && node.entityKeys.every((k) => s.isolated.has(k));
      return { selected, check, isRowIsolated: isIso };
    }),
  );

  const allHidden = rowCheckState === 'off';
  const dim = allHidden;

  const select = useViewerEntityStore((s) => s.select);
  const clearSelection = useViewerEntityStore((s) => s.clearSelection);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const showItems = useViewerEntityStore((s) => s.showItems);
  const isolateItems = useViewerEntityStore((s) => s.isolateItems);
  const showAll = useViewerEntityStore((s) => s.showAll);
  const requestFrame = useViewerEntityStore((s) => s.requestFrame);

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (node.entityKeys.length === 0) return;
      if (e.detail === 2) return; // double-click — let handleDoubleClick handle it
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (isRowSelected) {
          clearSelection();
        } else {
          select(node.entityKeys);
        }
      }, 200);
    },
    [node.entityKeys, isRowSelected, select, clearSelection],
  );

  const handleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      if (node.entityKeys.length === 0) return;
      select(node.entityKeys);
      isolateItems(node.entityKeys);
      requestFrame();
    },
    [node.entityKeys, select, isolateItems, requestFrame],
  );

  const handleCheckboxChange = useCallback(() => {
    if (node.entityKeys.length === 0) return;
    if (rowCheckState === 'on') {
      hideItems(node.entityKeys);
    } else {
      showItems(node.entityKeys);
    }
  }, [node.entityKeys, rowCheckState, showItems, hideItems]);

  const handleExpand = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (hasChildren) onToggleExpand(node.key);
    },
    [node.key, hasChildren, onToggleExpand],
  );

  const handleIsolate = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (node.entityKeys.length === 0) return;
      if (isRowIsolated) {
        showAll();
      } else {
        isolateItems(node.entityKeys);
      }
    },
    [node.entityKeys, isRowIsolated, isolateItems, showAll],
  );

  return (
    <div style={style}>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isRowSelected}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'group flex h-full select-none items-center gap-2 pr-2 text-[13px]',
          'cursor-pointer',
          'transition-colors duration-100',
          isRowSelected
            ? 'border-l-2 border-primary bg-primary-light'
            : 'border-l-2 border-transparent hover:bg-background-hover',
          dim && 'opacity-[0.55]',
        )}
        style={{ paddingLeft: `${String(leftPad)}px` }}
      >
        {/* Expand / collapse chevron */}
        <button
          type="button"
          onClick={handleExpand}
          className="inline-grid h-4 w-4 shrink-0 place-items-center border-none bg-transparent p-0"
          style={{ cursor: hasChildren ? 'pointer' : 'default' }}
          tabIndex={-1}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <span
            aria-hidden="true"
            className="inline-grid size-3.5 place-items-center text-foreground-tertiary transition-transform duration-[120ms]"
            style={{
              opacity: hasChildren ? 1 : 0,
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2.5,1.5 5.5,4 2.5,6.5" />
            </svg>
          </span>
        </button>

        {/* Tri-state checkbox */}
        <TriCheckbox state={rowCheckState} onChange={handleCheckboxChange} />

        {/* Color dot */}
        {node.color != null && (
          <span
            className="size-2.5 shrink-0 rounded-xs"
            style={{
              background: node.color,
              boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.10)',
            }}
          />
        )}

        {/* Label */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate leading-none',
            node.mono ? 'font-sans tracking-[-0.01em]' : 'font-sans tracking-[-0.005em]',
            isRowSelected ? 'font-semibold text-primary' : 'font-medium text-foreground',
          )}
          title={node.label}
        >
          {node.label}
        </span>

        {/* Count chip */}
        {typeof node.count === 'number' && (
          <CountChip
            className={cn(
              'shrink-0 rounded-xs px-[5px] py-px',
              isRowSelected && 'bg-primary-light',
            )}
          >
            {node.count.toLocaleString()}
          </CountChip>
        )}

        {/* Hover actions: select + isolate */}
        <span className="inline-flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={handleIsolate}
            title={t('isolate')}
            className={cn(
              'inline-grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-[3px] border-none bg-transparent p-0',
              isRowIsolated ? 'text-primary' : 'text-foreground-tertiary',
            )}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" strokeDasharray="3 2" />
              <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  );
}

export const TreeRow = memo(TreeRowInner);
