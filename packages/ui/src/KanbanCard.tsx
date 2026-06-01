'use client';

import { useDraggable } from '@dnd-kit/core';
import { forwardRef, useRef, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type KanbanCardProps = Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
  id: string;
  children: ReactNode;
  disabled?: boolean;
  onCardClick?: () => void;
};

const DRAG_THRESHOLD = 4;

export const KanbanCard = forwardRef<HTMLDivElement, KanbanCardProps>(
  ({ id, disabled, onCardClick, className, children, ...rest }, ref) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
      id,
      ...(disabled !== undefined ? { disabled } : {}),
    });

    const pointerStart = useRef<{ x: number; y: number } | null>(null);

    const handlePointerDown = (e: MouseEvent<HTMLDivElement>): void => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      if (listeners?.onPointerDown !== undefined) {
        (listeners.onPointerDown as (e: unknown) => void)(e);
      }
    };

    const handleClick = (e: MouseEvent<HTMLDivElement>): void => {
      if (pointerStart.current === null) return;
      const dx = Math.abs(e.clientX - pointerStart.current.x);
      const dy = Math.abs(e.clientY - pointerStart.current.y);
      pointerStart.current = null;
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        onCardClick?.();
      }
    };

    return (
      <div
        ref={(node) => {
          setNodeRef(node);
          if (typeof ref === 'function') ref(node);
          else if (ref !== null && ref !== undefined) {
            (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }
        }}
        {...attributes}
        {...listeners}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        className={cn(
          'rounded-lg border border-border bg-background p-3 shadow-sm transition-all',
          disabled ? 'cursor-default opacity-60' : 'cursor-grab active:cursor-grabbing',
          isDragging && 'opacity-40',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

KanbanCard.displayName = 'KanbanCard';
