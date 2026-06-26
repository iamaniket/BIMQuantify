'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState, type JSX, type ReactNode } from 'react';

import { cn } from './lib/cn.js';
import { KanbanCard } from './KanbanCard.js';
import { KanbanColumn } from './KanbanColumn.js';

export type KanbanColumnDef = {
  id: string;
  label: string;
  accentColor?: string;
};

export type KanbanBoardProps<T> = {
  columns: KanbanColumnDef[];
  items: T[];
  getItemColumn: (item: T) => string;
  getItemId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove?: (itemId: string, fromColumn: string, toColumn: string) => void;
  canDrop?: (itemId: string, fromColumn: string, toColumn: string) => boolean;
  /** Fired when a drop lands on a column that `canDrop` rejected. */
  onInvalidDrop?: (itemId: string, fromColumn: string, toColumn: string) => void;
  renderOverlay?: (item: T) => ReactNode;
  emptyLabel?: string;
  className?: string;
  cardClassName?: string;
  isItemDisabled?: (item: T) => boolean;
  onCardClick?: (item: T) => void;
};

export function KanbanBoard<T>({
  columns,
  items,
  getItemColumn,
  getItemId,
  renderCard,
  onMove,
  canDrop,
  onInvalidDrop,
  renderOverlay,
  emptyLabel,
  className,
  cardClassName,
  isItemDisabled,
  onCardClick,
}: KanbanBoardProps<T>): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const activeItem = activeId !== null
    ? items.find((item) => getItemId(item) === activeId) ?? null
    : null;

  const activeColumn = activeItem !== null ? getItemColumn(activeItem) : null;

  // Bucket items by column once per render (O(n)) instead of re-filtering the
  // full list for every column (O(columns × items)).
  const itemsByColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const col = getItemColumn(item);
      const bucket = map.get(col);
      if (bucket) bucket.push(item);
      else map.set(col, [item]);
    }
    return map;
  }, [items, getItemColumn]);

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null);
    const { active, over } = event;
    if (over === null) return;

    const itemId = String(active.id);
    const item = items.find((i) => getItemId(i) === itemId);
    if (item === undefined) return;

    const fromColumn = getItemColumn(item);
    const toColumn = String(over.id);

    if (fromColumn === toColumn) return;
    if (!columns.some((c) => c.id === toColumn)) return;

    if (canDrop !== undefined && !canDrop(itemId, fromColumn, toColumn)) {
      onInvalidDrop?.(itemId, fromColumn, toColumn);
      return;
    }

    onMove?.(itemId, fromColumn, toColumn);
  };

  const handleDragCancel = (): void => {
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={cn('flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2', className)}>
        {columns.map((col) => {
          const columnItems = itemsByColumn.get(col.id) ?? [];
          const isDropAllowed = activeId !== null && activeColumn !== col.id && (
            canDrop === undefined || canDrop(activeId, activeColumn ?? '', col.id)
          );

          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              count={columnItems.length}
              {...(col.accentColor !== undefined ? { accentColor: col.accentColor } : {})}
              {...(emptyLabel !== undefined ? { emptyLabel } : {})}
              dropAllowed={activeId === null || isDropAllowed}
            >
              {columnItems.map((item) => {
                const itemId = getItemId(item);
                const itemDisabled = isItemDisabled?.(item) ?? false;
                return (
                  <KanbanCard
                    key={itemId}
                    id={itemId}
                    disabled={itemDisabled}
                    onCardClick={() => { onCardClick?.(item); }}
                    className={cardClassName}
                  >
                    {renderCard(item)}
                  </KanbanCard>
                );
              })}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem !== null && (
          <div className={cn('max-w-[320px] rounded-lg border border-primary bg-background shadow-lg', cardClassName)}>
            {(renderOverlay ?? renderCard)(activeItem)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

KanbanBoard.displayName = 'KanbanBoard';
