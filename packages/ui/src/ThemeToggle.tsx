'use client';

import { Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type JSX } from 'react';

import { cn } from './lib/cn.js';

type Props = {
  className?: string;
  /**
   * Localized accessible label, applied to both `aria-label` and `title`. The
   * package stays i18n-agnostic; consumers pass a translated string. Falls back
   * to an English default so the component works standalone.
   */
  ariaLabel?: string | undefined;
};

export function ThemeToggle({ className, ariaLabel }: Props): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const nextTheme = isDark ? 'light' : 'dark';
  const label = ariaLabel ?? `Switch to ${nextTheme} theme`;

  const toggleTheme = (): void => {
    const apply = (): void => setTheme(nextTheme);
    // Progressive enhancement: cross-fade the theme flip via the View
    // Transitions API where available. Reduced-motion users and browsers
    // without the API keep the instant flip (the provider's
    // `disableTransitionOnChange` hard cut). Typed via a local cast — the API
    // isn't in every TS DOM lib yet.
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => {
        ready: Promise<void>;
        finished: Promise<void>;
        updateCallbackDone: Promise<void>;
      };
    };
    if (
      typeof doc.startViewTransition === 'function' &&
      !doc.hidden &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // A skipped transition (rapid re-toggle, tab hidden mid-flight) rejects
      // its promises; the theme still flips, so swallow the rejections.
      const transition = doc.startViewTransition(apply);
      transition.ready.catch(() => undefined);
      transition.finished.catch(() => undefined);
      transition.updateCallbackDone.catch(() => undefined);
    } else {
      apply();
    }
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md',
        'text-foreground-secondary hover:text-foreground hover:bg-background-hover',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {/* Render both icons to avoid hydration flicker; the data-theme attribute hides one. */}
      <Sun weight="fill" className="h-5 w-5 dark:hidden" aria-hidden />
      <Moon weight="fill" className="hidden h-5 w-5 dark:block" aria-hidden />
    </button>
  );
}
