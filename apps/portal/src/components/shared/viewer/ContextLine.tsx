'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

type ContextLineProps = {
  /** Short, emphasised tag (e.g. an IFC schema or format code). */
  tag: string;
  /** The contextual subject the tag belongs to (e.g. a project or element name). */
  name: ReactNode;
  className?: string;
};

/**
 * Shared side-panel context strip: a bold `tag : name` line that anchors a
 * panel to whatever it is currently scoped to (project, model, element).
 * Store-agnostic — data flows in via props.
 */
export function ContextLine({ tag, name, className }: ContextLineProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 truncate border-b border-border bg-surface-main px-3.5 py-2 leading-snug',
        className,
      )}
    >
      <span className="shrink-0 font-sans text-caption font-bold uppercase tracking-[0.06em] text-foreground">
        {tag}
      </span>
      <span className="shrink-0 text-foreground-tertiary">:</span>
      <span className="truncate font-sans text-body3 font-semibold text-foreground-secondary">
        {name}
      </span>
    </div>
  );
}
