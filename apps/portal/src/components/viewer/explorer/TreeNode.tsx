'use client';

import { ChevronRight, Eye, EyeOff, Glasses } from 'lucide-react';
import { type JSX, useCallback, memo } from 'react';

import { cn } from '@bimstitch/ui';

import { useViewerEntityStore, type EntityKey } from '@/stores/viewerEntityStore';

export type TreeNodeData = {
  key: string;
  label: string;
  type?: string;
  entityKeys: EntityKey[];
  children?: TreeNodeData[];
};

type TreeNodeProps = {
  node: TreeNodeData;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
};

function TreeNodeInner({
  node,
  depth,
  expanded,
  onToggleExpand,
}: TreeNodeProps): JSX.Element {
  const isExpanded = expanded.has(node.key);
  const hasChildren = (node.children?.length ?? 0) > 0;

  const isSelected = useViewerEntityStore((s) =>
    node.entityKeys.some((k) => s.selected.has(k)),
  );
  const isHidden = useViewerEntityStore((s) =>
    node.entityKeys.length > 0 && node.entityKeys.every((k) => s.hidden.has(k)),
  );
  const isXrayed = useViewerEntityStore((s) =>
    node.entityKeys.length > 0 && node.entityKeys.every((k) => s.xrayed.has(k)),
  );

  const select = useViewerEntityStore((s) => s.select);
  const hideItems = useViewerEntityStore((s) => s.hideItems);
  const showItems = useViewerEntityStore((s) => s.showItems);
  const xrayItems = useViewerEntityStore((s) => s.xrayItems);
  const unxrayItems = useViewerEntityStore((s) => s.unxrayItems);

  const handleClick = useCallback(() => {
    if (node.entityKeys.length > 0) {
      select(node.entityKeys);
    }
  }, [node.entityKeys, select]);

  const handleToggleVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.entityKeys.length === 0) return;
      if (isHidden) {
        showItems(node.entityKeys);
      } else {
        hideItems(node.entityKeys);
      }
    },
    [node.entityKeys, isHidden, showItems, hideItems],
  );

  const handleToggleXray = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.entityKeys.length === 0) return;
      if (isXrayed) {
        unxrayItems(node.entityKeys);
      } else {
        xrayItems(node.entityKeys);
      }
    },
    [node.entityKeys, isXrayed, xrayItems, unxrayItems],
  );

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(node.key);
    },
    [node.key, onToggleExpand],
  );

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        className={cn(
          'group flex items-center gap-1 py-0.5 pr-1 cursor-pointer select-none',
          'hover:bg-background-secondary rounded',
          isSelected && 'bg-primary/10',
          isHidden && 'opacity-40',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={handleClick}
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

        <span
          className={cn(
            'flex-1 truncate text-caption',
            isXrayed && 'text-blue-500',
          )}
          title={node.label}
        >
          {node.label}
          {node.type != null ? (
            <span className="ml-1 text-foreground-tertiary">
              ({node.type})
            </span>
          ) : null}
        </span>

        <div className="hidden gap-0.5 group-hover:flex">
          {node.entityKeys.length > 0 ? (
            <>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-background-tertiary"
                onClick={handleToggleVisibility}
                title={isHidden ? 'Show' : 'Hide'}
              >
                {isHidden ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-background-tertiary"
                onClick={handleToggleXray}
                title={isXrayed ? 'Clear X-Ray' : 'X-Ray'}
              >
                <Glasses
                  className={cn('h-3 w-3', isXrayed && 'text-blue-500')}
                />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isExpanded && node.children != null
        ? node.children.map((child) => (
            <TreeNodeComponent
              key={child.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
            />
          ))
        : null}
    </div>
  );
}

export const TreeNodeComponent = memo(TreeNodeInner);
