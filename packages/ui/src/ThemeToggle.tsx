'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type JSX } from 'react';

import { cn } from './lib/cn.js';

type Props = {
  className?: string;
};

export function ThemeToggle({ className }: Props): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const nextTheme = isDark ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} theme`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md',
        'text-foreground-secondary hover:text-foreground hover:bg-background-hover',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {/* Render both icons to avoid hydration flicker; the data-theme attribute hides one. */}
      <Sun className="h-5 w-5 dark:hidden" aria-hidden />
      <Moon className="hidden h-5 w-5 dark:block" aria-hidden />
    </button>
  );
}
