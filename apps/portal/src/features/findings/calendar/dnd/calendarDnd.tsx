'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { JSX, ReactNode } from 'react';

import type { CalendarEventKind } from '../calendarEvents';

/** Droppable-id scheme: each day is `day:<iso>`; the unscheduled tray is fixed. */
export const DAY_DROP_PREFIX = 'day:';
export const UNSCHEDULED_DROP_ID = 'unscheduled';

type DraggableEventProps = {
  /** The calendar event id (e.g. `finding:abc`). */
  id: string;
  kind: CalendarEventKind;
  children: ReactNode;
};

/**
 * Wraps a chip or row so it can be dragged onto a day or the unscheduled tray.
 * The PointerSensor only starts a drag past a small threshold, so a plain click
 * still reaches the wrapped control (open detail, select the day, …).
 */
export function DraggableEvent({ id, kind, children }: DraggableEventProps): JSX.Element {
  const {
    attributes, listeners, setNodeRef, isDragging,
  } = useDraggable({ id, data: { kind } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      {children}
    </div>
  );
}

/** Makes one day cell a drop target, highlighting while a drag hovers it. */
export function DroppableDay({ iso, children }: { iso: string; children: ReactNode }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}${iso}` });
  return (
    <div
      ref={setNodeRef}
      className={`h-full transition-colors ${
        isOver
          ? 'bg-gradient-to-br from-primary-light to-primary-lighter ring-2 ring-inset ring-primary'
          : ''
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The unscheduled tray as a drop target — dropping a finding here clears its
 * date. Only highlights for findings; a moment has no nullable date, so it
 * cannot be un-scheduled.
 */
export function DroppableUnscheduled({ children }: { children: ReactNode }): JSX.Element {
  const { setNodeRef, isOver, active } = useDroppable({ id: UNSCHEDULED_DROP_ID });
  const validTarget = active?.data.current?.['kind'] === 'finding';
  return (
    <div
      ref={setNodeRef}
      className={isOver && validTarget ? 'rounded-lg ring-2 ring-inset ring-primary/50' : ''}
    >
      {children}
    </div>
  );
}
