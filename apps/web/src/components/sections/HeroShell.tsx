import type { JSX, ReactNode } from 'react';

import { HeroGrid } from '@bimdossier/brand';
import { cn } from '@bimdossier/ui';

type HeroSize = 'splash' | 'page';

/**
 * Fixed minimum heights per hero size. The min-height (paired with the
 * `justify-center` on the content container) is what keeps the hero box the
 * same height across languages: as long as the floor is >= the natural height
 * of the taller language, both EN and NL render at exactly this height. Values
 * are tuned by browser measurement (see the plan's verification section).
 */
const SIZE_CLASSES: Record<HeroSize, string> = {
  // home + contact (big splash with headline + CTA). Floors are measured to
  // cover the taller language (Dutch) so EN and NL render identically: ~986px
  // down to a 360px viewport, ~760px from the sm breakpoint up.
  splash: 'min-h-[986px] py-24 sm:min-h-[760px] sm:py-32',
  // features + blog (compact page header). Floors cover the tallest feature
  // tagline+intro across both languages: ~540px on mobile, ~460px from sm up.
  page: 'min-h-[540px] py-16 sm:min-h-[460px] sm:py-20',
};

export type HeroShellProps = {
  size?: HeroSize;
  align?: 'start' | 'center';
  /**
   * Load-stagger the content container's direct children (`.hero-stagger` in
   * globals.css: rise-in, 60ms steps; the h1 rises without a fade — LCP
   * guard). Off by default; the home hero opts in.
   */
  stagger?: boolean;
  /** Extra classes for the inner content container (gap-*, max-w-* override, …). */
  className?: string;
  children: ReactNode;
}

/**
 * Shared marketing hero shell: the brand backdrop (gradient + blueprint grid +
 * green radial glow) plus a height-stable, vertically-centered content
 * container. Each hero passes its own content as children and keeps its own
 * typography; the shell owns the backdrop, height, width, and alignment so
 * every hero shares one look and feel and a language-independent height.
 *
 * The grid + glow layers carry `hero-parallax-*` classes that consume the
 * `--hpx`/`--hpy` custom properties via `translate3d(calc(...))`. Only heroes
 * that mount `HeroParallaxDriver` (the home hero) ever set those vars; every
 * other hero resolves them to 0 — zero behavior change.
 */
export function HeroShell({
  size = 'splash',
  align = 'start',
  stagger = false,
  className,
  children,
}: HeroShellProps): JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]" />
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} className="hero-parallax-grid" />
      <div className="hero-parallax-glow absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(95,217,158,0.15),transparent)]" />

      {/* `isolate` scopes children's z-indexes to this container, so the home
          hero's -z-10 blueprint art sits behind the copy but above the
          backdrop layers. */}
      <div
        className={cn(
          'relative isolate mx-auto flex w-full max-w-8xl flex-col justify-center px-6',
          SIZE_CLASSES[size],
          align === 'center' && 'items-center text-center',
          stagger && 'hero-stagger',
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}
