'use client';

import {
  type CSSProperties,
  type JSX,
  type MouseEvent,
  useCallback,
  memo,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@bimstitch/ui';
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
  const [hover, setHover] = useState(false);
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

  const handleSelect = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (node.entityKeys.length === 0) return;
      if (isRowSelected) {
        clearSelection();
      } else {
        select(node.entityKeys);
      }
    },
    [node.entityKeys, isRowSelected, select, clearSelection],
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

  const bgColor = (() => {
    if (isRowSelected) return 'var(--primary-light)';
    if (hover) return 'var(--bg-hover)';
    return 'transparent';
  })();

  return (
    <div style={style}>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isRowSelected}
        onClick={() => { if (hasChildren) onToggleExpand(node.key); }}
        onMouseEnter={() => { setHover(true); }}
        onMouseLeave={() => { setHover(false); }}
        className={cn(
          'group flex h-full select-none items-center gap-2 pr-2',
          hasChildren ? 'cursor-pointer' : 'cursor-default',
          'transition-colors duration-100',
          isRowSelected
            ? 'border-l-2 border-primary'
            : 'border-l-2 border-transparent',
        )}
        style={{
          paddingLeft: `${String(leftPad)}px`,
          background: bgColor,
          opacity: dim ? 0.55 : 1,
          fontSize: 13,
        }}
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
            className="inline-grid place-items-center transition-transform duration-[120ms]"
            style={{
              width: 14,
              height: 14,
              opacity: hasChildren ? 1 : 0,
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              color: 'var(--fg-3)',
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
            className="shrink-0 rounded-[2px]"
            style={{
              width: 10,
              height: 10,
              background: node.color,
              boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.10)',
            }}
          />
        )}

        {/* Label */}
        <span
          className="min-w-0 flex-1 truncate leading-none"
          style={{
            fontFamily: node.mono ? 'var(--mono)' : 'var(--sans)',
            fontWeight: isRowSelected ? 600 : 500,
            color: isRowSelected ? 'var(--primary)' : 'var(--fg)',
            letterSpacing: node.mono ? '-0.01em' : '-0.005em',
          }}
          title={node.label}
        >
          {node.label}
        </span>

        {/* Count chip */}
        {typeof node.count === 'number' && (
          <span
            className="shrink-0 tabular-nums"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              color: 'var(--fg-3)',
              padding: '1px 5px',
              borderRadius: 3,
              background: isRowSelected ? 'rgba(44,86,151,0.10)' : 'transparent',
            }}
          >
            {node.count.toLocaleString()}
          </span>
        )}

        {/* Hover actions: select + isolate */}
        <span
          className="inline-flex shrink-0 gap-0.5 transition-opacity duration-100"
          style={{ opacity: hover ? 1 : 0 }}
        >
          <button
            type="button"
            onClick={handleSelect}
            title={t('select')}
            className="inline-grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-[3px] border-none bg-transparent p-0"
            style={{ color: isRowSelected ? 'var(--primary)' : 'var(--fg-3)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3l14 9-7 2-4 7-3-14z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleIsolate}
            title={t('isolate')}
            className="inline-grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-[3px] border-none bg-transparent p-0"
            style={{ color: isRowIsolated ? 'var(--primary)' : 'var(--fg-3)' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  );
}

export const TreeRow = memo(TreeRowInner);
