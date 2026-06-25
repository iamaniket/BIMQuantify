import { cn } from '@bimdossier/ui';
import type { JSX, ReactNode } from 'react';

type HeroPillProps = {
  children: ReactNode;
  /** Tighter horizontal padding (px-2) for tag chips. */
  compact?: boolean;
  className?: string;
};

/**
 * White-on-gradient pill used inside `HeroShell` (badges, title chips, tags).
 * The translucent-white look only reads on the brand gradient, so this lives
 * next to `HeroShell` rather than in `@bimdossier/ui` (whose `Badge` is
 * token-themed for on-surface use).
 */
export function HeroPill({ children, compact, className }: HeroPillProps): JSX.Element {
  return (
    <span
      className={cn(
        'w-fit rounded-full border border-white/20 bg-white/10 py-1 text-body3 font-medium text-white/90',
        compact ? 'px-2' : 'px-3',
        className,
      )}
    >
      {children}
    </span>
  );
}
