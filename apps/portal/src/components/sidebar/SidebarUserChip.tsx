'use client';

import { LogOut, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { useTheme } from 'next-themes';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';

export function SidebarUserChip(): JSX.Element {
  const { collapsed } = useSidebar();
  const { setTokens } = useAuth();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const onSignOut = (): void => {
    setTokens(null);
    router.replace('/login');
  };

  const toggleTheme = (): void => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-white/12 px-2 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleTheme}
              className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <ThemeIcon className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {resolvedTheme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="grid h-8 w-8 cursor-default place-items-center rounded-full bg-primary-light text-caption font-extrabold text-primary"
              title="Lieke Beumer · Wkb-inspecteur"
            >
              LB
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Lieke Beumer · Wkb-inspecteur</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 border-t border-white/12 px-3 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-light text-caption font-extrabold text-primary">
        LB
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body3 font-semibold text-white">Lieke Beumer</div>
        <div className="truncate text-caption text-white/55">Wkb-inspecteur · Admin</div>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ThemeIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onSignOut}
        title="Sign out"
        className="shrink-0 text-white/55 transition-colors hover:text-white"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
