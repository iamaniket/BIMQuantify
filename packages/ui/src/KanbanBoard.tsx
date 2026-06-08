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
import { useState, type JSX, type ReactNode } from 'react';

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

    if (canDrop !== undefined && !canDrop(itemId, fromColumn, toColumn)) return;

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
          const columnItems = items.filter((item) => getItemColumn(item) === col.id);
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
