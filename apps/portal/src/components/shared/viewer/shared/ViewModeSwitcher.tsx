'use client';

import { Blueprint, Box, SquareSplitHorizontal } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * Viewport layout for an IFC model.
 *   - `3d`    — 3D model only (floor-plan minimap as a corner overlay).
 *   - `split` — 3D + the 2D floor plan side by side (stacked on mobile).
 *   - `2d`    — the 2D floor plan fills the viewport.
 */
export type ViewMode = '3d' | 'split' | '2d';

type Props = {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
};

const ICONS: Record<ViewMode, typeof Box> = {
  '3d': Box,
  split: SquareSplitHorizontal,
  '2d': Blueprint,
};

/**
 * Segmented 3D / Split / 2D control. Pure props — the host owns the layout
 * state and decides whether to render it (only when a floor-plan artifact
 * exists). Lives in `components/shared/viewer` per the shared-component rule.
 */
export function ViewModeSwitcher({ value, onChange, className }: Props): JSX.Element {
  const t = useTranslations('viewer.viewMode');
  const items: { mode: ViewMode; label: string; tip: string }[] = [
    { mode: '3d', label: t('model'), tip: t('modelTooltip') },
    { mode: 'split', label: t('split'), tip: t('splitTooltip') },
    { mode: '2d', label: t('plan'), tip: t('planTooltip') },
  ];

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={`flex items-center gap-0.5 rounded-md border border-border bg-surface-low/95 p-0.5 shadow-md backdrop-blur-sm ${className ?? ''}`}
    >
      {items.map(({ mode, label, tip }) => {
        const Icon = ICONS[mode];
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            title={tip}
            aria-pressed={active}
            onClick={() => onChange(mode)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-caption font-medium transition-colors ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-foreground-secondary hover:bg-background-hover hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
