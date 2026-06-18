'use client';

import type { JSX, ReactNode } from 'react';

import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type RevealProps = {
  children: ReactNode;
  /** Stagger delay in ms (e.g. `index * 80` for a cascade). */
  delay?: number;
  className?: string;
};

/**
 * Fade + 16px rise as the element scrolls into view. Dependency-free
 * (IntersectionObserver + a CSS transition), GPU-friendly (only opacity +
 * transform, so no layout thrash — the element holds its final box throughout).
 * `prefers-reduced-motion` shows the content immediately with no transform, both
 * via the `motion-reduce` Tailwind variant and the hook (belt and suspenders).
 */
export function Reveal({ children, delay = 0, className }: RevealProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ once: true });
  const visible = reducedMotion || inView;

  return (
    <div
      ref={ref}
      data-state={visible ? 'visible' : 'hidden'}
      style={delay > 0 && !reducedMotion ? { transitionDelay: `${delay}ms` } : undefined}
      className={[
        'transition-[opacity,transform] duration-700 ease-out',
        'data-[state=hidden]:translate-y-4 data-[state=hidden]:opacity-0',
        'data-[state=visible]:translate-y-0 data-[state=visible]:opacity-100',
        'motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
