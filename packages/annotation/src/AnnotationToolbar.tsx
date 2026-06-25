/**
 * Props-only annotation toolbar. Holds no domain state — the host owns the
 * active tool, style, history and selection, and passes localized `labels` in
 * (the package is i18n-agnostic, mirroring the PDF viewer's MarkupToolbar).
 *
 * Chrome uses Tailwind/design-token classes; the host app must include this
 * package's `src` in its Tailwind `content` globs (as it does for `@bimdossier/ui`).
 */

import type { JSX } from 'react';

import {
  ArrowIcon,
  BlurIcon,
  CloudIcon,
  CursorIcon,
  EllipseIcon,
  FreehandIcon,
  LineIcon,
  RectangleIcon,
  RedoIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
} from './icons.js';
import { STROKE_PRESETS } from './shapes.js';
import type { MarkupTool } from './types.js';

/** `'select'` is the non-drawing pointer mode (select / move / resize). */
export type ToolbarTool = MarkupTool | 'select';

export interface AnnotationToolbarLabels {
  select: string;
  rectangle: string;
  ellipse: string;
  line: string;
  arrow: string;
  cloud: string;
  freehand: string;
  text: string;
  blur: string;
  color: string;
  strokeWidth: string;
  thin: string;
  medium: string;
  thick: string;
  undo: string;
  redo: string;
  delete: string;
  clear: string;
}

/** The default annotation colours (user content — hence literal hex, like the PDF toolbar). */
export const ANNOTATION_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b'] as const;

export interface AnnotationToolbarProps {
  tool: ToolbarTool;
  onToolChange: (tool: ToolbarTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  canDelete: boolean;
  onClear: () => void;
  canClear: boolean;
  labels: AnnotationToolbarLabels;
  className?: string;
}

type ToolDef = { tool: ToolbarTool; Icon: (p: { className?: string }) => JSX.Element; labelKey: keyof AnnotationToolbarLabels };

const TOOLS: ToolDef[] = [
  { tool: 'select', Icon: CursorIcon, labelKey: 'select' },
  { tool: 'rect', Icon: RectangleIcon, labelKey: 'rectangle' },
  { tool: 'ellipse', Icon: EllipseIcon, labelKey: 'ellipse' },
  { tool: 'line', Icon: LineIcon, labelKey: 'line' },
  { tool: 'arrow', Icon: ArrowIcon, labelKey: 'arrow' },
  { tool: 'cloud', Icon: CloudIcon, labelKey: 'cloud' },
  { tool: 'freehand', Icon: FreehandIcon, labelKey: 'freehand' },
  { tool: 'text', Icon: TextIcon, labelKey: 'text' },
  { tool: 'blur', Icon: BlurIcon, labelKey: 'blur' },
];

const STROKE_TIERS: { value: number; labelKey: keyof AnnotationToolbarLabels; dot: number }[] = [
  { value: STROKE_PRESETS.thin, labelKey: 'thin', dot: 2 },
  { value: STROKE_PRESETS.medium, labelKey: 'medium', dot: 4 },
  { value: STROKE_PRESETS.thick, labelKey: 'thick', dot: 6 },
];

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const ICON_BTN_BASE =
  'inline-grid h-7 w-7 place-items-center rounded transition-colors disabled:opacity-40 disabled:pointer-events-none';

export function AnnotationToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDelete,
  canDelete,
  onClear,
  canClear,
  labels,
  className,
}: AnnotationToolbarProps): JSX.Element {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-low px-1.5 py-1 shadow-sm',
        className,
      )}
    >
      {TOOLS.map(({ tool: t, Icon, labelKey }) => (
        <button
          key={t}
          type="button"
          title={labels[labelKey]}
          aria-label={labels[labelKey]}
          aria-pressed={tool === t}
          onClick={() => { onToolChange(t); }}
          className={cx(
            ICON_BTN_BASE,
            tool === t
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground-secondary hover:bg-background-hover hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${labels.color}: ${c}`}
          aria-pressed={color.toLowerCase() === c}
          onClick={() => { onColorChange(c); }}
          className={cx(
            'h-5 w-5 rounded-full border transition-transform hover:scale-110',
            color.toLowerCase() === c ? 'border-foreground' : 'border-transparent',
          )}
          style={{ backgroundColor: c }}
        />
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      {STROKE_TIERS.map(({ value, labelKey, dot }) => (
        <button
          key={value}
          type="button"
          title={labels[labelKey]}
          aria-label={`${labels.strokeWidth}: ${labels[labelKey]}`}
          aria-pressed={strokeWidth === value}
          onClick={() => { onStrokeWidthChange(value); }}
          className={cx(
            ICON_BTN_BASE,
            strokeWidth === value
              ? 'bg-background-hover text-foreground'
              : 'text-foreground-secondary hover:bg-background-hover hover:text-foreground',
          )}
        >
          <span className="rounded-full bg-current" style={{ width: dot, height: dot }} />
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      <button
        type="button"
        title={labels.undo}
        aria-label={labels.undo}
        disabled={!canUndo}
        onClick={onUndo}
        className={cx(ICON_BTN_BASE, 'text-foreground-secondary hover:bg-background-hover hover:text-foreground')}
      >
        <UndoIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title={labels.redo}
        aria-label={labels.redo}
        disabled={!canRedo}
        onClick={onRedo}
        className={cx(ICON_BTN_BASE, 'text-foreground-secondary hover:bg-background-hover hover:text-foreground')}
      >
        <RedoIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title={labels.delete}
        aria-label={labels.delete}
        disabled={!canDelete}
        onClick={onDelete}
        className={cx(ICON_BTN_BASE, 'text-foreground-secondary hover:bg-background-hover hover:text-error')}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title={labels.clear}
        aria-label={labels.clear}
        disabled={!canClear}
        onClick={onClear}
        className={cx(
          ICON_BTN_BASE,
          'w-auto px-2 text-caption text-foreground-secondary hover:bg-background-hover hover:text-foreground',
        )}
      >
        {labels.clear}
      </button>
    </div>
  );
}
