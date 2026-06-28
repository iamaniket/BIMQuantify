'use client';

import {
  type CSSProperties, type JSX, type ReactElement, useMemo,
} from 'react';
import { List } from 'react-window';

import { TreeRow } from './TreeRow';
import type { TreeNodeData } from './TreeNode';

// `isExpanded` is precomputed here (the walk already reads `expanded.has`) so
// TreeRow takes a primitive boolean instead of the whole `expanded` Set. The
// Set's identity changes on every toggle, which forced every mounted TreeRow's
// memo to invalidate; a per-row boolean lets memo(TreeRow) bail out for rows
// whose own state didn't change.
export type FlatRow = { node: TreeNodeData; depth: number; isExpanded: boolean };

function flattenTree(
  roots: TreeNodeData[],
  expanded: Set<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (node: TreeNodeData, depth: number): void => {
    const isExpanded = expanded.has(node.key);
    rows.push({ node, depth, isExpanded });
    if (isExpanded && node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

const ROW_HEIGHT = 30;

type RowProps = {
  rows: FlatRow[];
  onToggleExpand: (key: string) => void;
};

function VirtualRow({
  index,
  style,
  rows,
  onToggleExpand,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
} & RowProps): ReactElement {
  const row = rows[index];
  if (!row) return <div style={style} />;
  return (
    <TreeRow
      style={style}
      node={row.node}
      depth={row.depth}
      isExpanded={row.isExpanded}
      onToggleExpand={onToggleExpand}
    />
  );
}

type VirtualizedTreeProps = {
  roots: TreeNodeData[];
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
};

export function VirtualizedTree({
  roots,
  expanded,
  onToggleExpand,
}: VirtualizedTreeProps): JSX.Element {
  const rows = useMemo(() => flattenTree(roots, expanded), [roots, expanded]);

  const rowProps = useMemo<RowProps>(
    () => ({ rows, onToggleExpand }),
    [rows, onToggleExpand],
  );

  return (
    <div role="tree" className="h-full w-full">
      <List
        rowCount={rows.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={VirtualRow}
        rowProps={rowProps}
        overscanCount={10}
        style={{ height: '100%' }}
      />
    </div>
  );
}
