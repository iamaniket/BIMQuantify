'use client';

import { type CSSProperties, type JSX, type ReactElement, useMemo } from 'react';
import { List } from 'react-window';

import { TreeRow } from './TreeRow';
import type { TreeNodeData } from './TreeNode';

export type FlatRow = { node: TreeNodeData; depth: number };

function flattenTree(
  roots: TreeNodeData[],
  expanded: Set<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (node: TreeNodeData, depth: number): void => {
    rows.push({ node, depth });
    if (expanded.has(node.key) && node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

const ROW_HEIGHT = 28;

type RowProps = {
  rows: FlatRow[];
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
};

function VirtualRow({
  index,
  style,
  rows,
  expanded,
  onToggleExpand,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
} & RowProps): ReactElement {
  const { node, depth } = rows[index]!;
  return (
    <TreeRow
      style={style}
      node={node}
      depth={depth}
      expanded={expanded}
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
    () => ({ rows, expanded, onToggleExpand }),
    [rows, expanded, onToggleExpand],
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
