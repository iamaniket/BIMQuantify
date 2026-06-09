'use client';

import { ArrowRight, Pencil, Square, StickyNote, UploadCloud } from '@bimstitch/ui/icons';
import { useEffect, useState, type JSX } from 'react';

import { cn, type AppIcon } from '@bimstitch/ui';
import type { DocumentViewerHandle, MarkupTool } from '@bimstitch/viewer';

const TOOLS: { tool: MarkupTool; icon: AppIcon; labelKey: string }[] = [
  { tool: 'rect', icon: Square, labelKey: 'rectangle' },
  { tool: 'arrow', icon: ArrowRight, labelKey: 'arrow' },
  { tool: 'cloud', icon: UploadCloud, labelKey: 'cloud' },
  { tool: 'freehand', icon: Pencil, labelKey: 'freehand' },
  { tool: 'text', icon: StickyNote, labelKey: 'text' },
];

const COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b'] as const;

type Props = {
  documentHandle: DocumentViewerHandle | null;
  /** Localized labels keyed by `labelKey` above (rectangle/arrow/cloud/freehand/text). */
  labels: Record<string, string>;
  className?: string;
  /** Notified whenever the active markup tool changes (null = none). */
  onActiveToolChange?: (tool: MarkupTool | null) => void;
};

export function MarkupToolbar({
  documentHandle,
  labels,
  className,
  onActiveToolChange,
}: Props): JSX.Element {
  const [active, setActive] = useState<MarkupTool | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);

  // The plugin self-deactivates the tool once a shape is drawn — reflect that.
  useEffect(() => {
    if (documentHandle === null) return undefined;
    const off = documentHandle.events.on('markup:draftComplete', () => {
      setActive(null);
      onActiveToolChange?.(null);
    });
    return off;
  }, [documentHandle, onActiveToolChange]);

  const selectTool = (tool: MarkupTool): void => {
    if (documentHandle === null) return;
    if (active === tool) {
      void documentHandle.commands.execute('markup.deactivate');
      setActive(null);
      onActiveToolChange?.(null);
      return;
    }
    void documentHandle.commands.execute('measure.deactivate').catch(() => undefined);
    void documentHandle.commands.execute('markup.setStyle', { color });
    void documentHandle.commands.execute('markup.activate', { mode: tool });
    setActive(tool);
    onActiveToolChange?.(tool);
  };

  const selectColor = (next: string): void => {
    setColor(next);
    if (documentHandle !== null) {
      void documentHandle.commands.execute('markup.setStyle', { color: next });
    }
  };

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-low px-1.5 py-1 shadow-md',
        className,
      )}
    >
      {TOOLS.map(({ tool, icon: Icon, labelKey }) => (
        <button
          key={tool}
          type="button"
          title={labels[labelKey] ?? tool}
          aria-pressed={active === tool}
          onClick={() => { selectTool(tool); }}
          className={cn(
            'inline-grid h-7 w-7 place-items-center rounded transition-colors',
            active === tool
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground-secondary hover:bg-background-hover hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={color === c}
          onClick={() => { selectColor(c); }}
          className={cn(
            'h-5 w-5 rounded-full border transition-transform hover:scale-110',
            color === c ? 'border-foreground' : 'border-transparent',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
