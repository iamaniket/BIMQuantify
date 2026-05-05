'use client';

import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { JSX } from 'react';

import { Link } from '@/i18n/navigation';

type ViewerHeaderProps = {
  projectId: string;
  projectName: string | null;
};

export function ViewerHeader({ projectId, projectName }: ViewerHeaderProps): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex h-[60px] shrink-0 items-center gap-4 bg-primary px-4 text-primary-foreground">
      <Link
        href={`/projects/${projectId}`}
        aria-label="Back to project"
        title="Back to project"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>

      <nav className="flex items-center gap-2 text-[13px]">
        <Link
          href="/projects"
          className="font-medium text-white/70 transition-colors hover:text-white"
        >
          Projects
        </Link>
        <ChevronRight className="h-3 w-3 text-white/40" />
        <Link
          href={`/projects/${projectId}`}
          className="font-medium text-white/70 transition-colors hover:text-white"
        >
          {projectName ?? '...'}
        </Link>
        <ChevronRight className="h-3 w-3 text-white/40" />
        <span className="font-semibold text-white">Viewer</span>
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        title={isDark ? 'Light mode' : 'Dark mode'}
        aria-label="Toggle theme"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
