'use client';

import { useEffect, useRef, type JSX } from 'react';

/**
 * Pointer-parallax driver for the hero backdrop. Renders a zero-size marker
 * div, finds the enclosing hero `<section>` on mount, and — only on
 * fine-pointer hover devices with motion allowed — lerps two CSS custom
 * properties (`--hpx` / `--hpy`, each −1..1) onto the section as the pointer
 * moves. The backdrop layers consume the vars at different depths via
 * `translate3d(calc(var(--hpx) * Npx), …)` (see `.hero-parallax-*` in
 * globals.css), so `HeroShell` stays a server component.
 *
 * Perf: one passive pointermove listener; all reads + math + writes happen in
 * a single rAF step (one `getBoundingClientRect()` per frame, before any
 * writes), and the loop self-stops once the lerp settles — an idle hero costs
 * nothing. On pointerleave it eases back to center.
 */
export function HeroParallaxDriver(): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof window.matchMedia !== 'function') return undefined;
    const section = el.closest('section');
    if (section === null) return undefined;
    // Decorative only: skip entirely on coarse/touch pointers and under
    // reduced motion (mount-time check; the vars then stay unset, so the
    // consuming transforms resolve to zero).
    if (
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return undefined;
    }

    let raf = 0;
    let pointerX = 0;
    let pointerY = 0;
    let hasPointer = false;
    let currentX = 0;
    let currentY = 0;

    const step = (): void => {
      raf = 0;
      // Single layout read per frame, before the style writes below.
      const rect = section.getBoundingClientRect();
      const targetX =
        hasPointer && rect.width > 0 ? ((pointerX - rect.left) / rect.width) * 2 - 1 : 0;
      const targetY =
        hasPointer && rect.height > 0 ? ((pointerY - rect.top) / rect.height) * 2 - 1 : 0;
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      if (Math.abs(targetX - currentX) < 0.001 && Math.abs(targetY - currentY) < 0.001) {
        // Settled: snap to the target and let the loop stop.
        currentX = targetX;
        currentY = targetY;
      } else {
        raf = requestAnimationFrame(step);
      }
      section.style.setProperty('--hpx', currentX.toFixed(4));
      section.style.setProperty('--hpy', currentY.toFixed(4));
    };

    const kick = (): void => {
      if (raf === 0) raf = requestAnimationFrame(step);
    };
    const onPointerMove = (event: PointerEvent): void => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      hasPointer = true;
      kick();
    };
    const onPointerLeave = (): void => {
      hasPointer = false;
      kick();
    };

    section.addEventListener('pointermove', onPointerMove, { passive: true });
    section.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      section.removeEventListener('pointermove', onPointerMove);
      section.removeEventListener('pointerleave', onPointerLeave);
      if (raf !== 0) cancelAnimationFrame(raf);
      section.style.removeProperty('--hpx');
      section.style.removeProperty('--hpy');
    };
  }, []);

  return <div ref={ref} aria-hidden data-hero-static className="hidden" />;
}
