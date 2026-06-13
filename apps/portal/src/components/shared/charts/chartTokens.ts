'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Canvas/uPlot cannot consume `var(--token)` — it needs a concrete color
 * string. These helpers read the computed value of a design-token CSS variable
 * off the document root, and re-read whenever the theme flips (next-themes
 * toggles `data-theme` on <html>).
 *
 * SVG/DOM charts (e.g. DonutChart) should keep using `var(--token)` directly
 * and ignore this module — they re-theme for free.
 */

/** Resolve a CSS custom property (e.g. '--primary') to its concrete value.
 * Returns an empty string during SSR (no document). */
export function readToken(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Convert a `#rgb` / `#rrggbb` hex (the format our tokens use) to an rgba()
 * string with the given alpha. Falls back to the input if it isn't hex. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (match === null) return color;
  let body = match[1] ?? '';
  if (body.length === 3) {
    body = body.split('').map((c) => c + c).join('');
  }
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

export type ChartColors = {
  primary: string;
  primaryLight: string;
  foregroundTertiary: string;
  border: string;
  surfaceLow: string;
  success: string;
  warning: string;
  error: string;
  info: string;
};

function readColors(): ChartColors {
  return {
    primary: readToken('--primary'),
    primaryLight: readToken('--primary-light'),
    foregroundTertiary: readToken('--foreground-tertiary'),
    border: readToken('--border'),
    surfaceLow: readToken('--surface-low'),
    success: readToken('--success'),
    warning: readToken('--warning'),
    error: readToken('--error'),
    info: readToken('--info'),
  };
}

/** Theme-reactive chart palette. The returned object's identity changes only
 * when the resolved theme changes, so it is safe as a hook/effect dependency. */
export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<ChartColors>(readColors);

  useEffect(() => {
    setColors(readColors());
  }, [resolvedTheme]);

  return colors;
}
