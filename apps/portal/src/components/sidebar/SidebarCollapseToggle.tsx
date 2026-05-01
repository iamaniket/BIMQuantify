'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JSX } from 'react';

import { useSidebar } from './SidebarContext';

export function SidebarCollapseToggle(): JSX.Element {
  const { collapsed, toggle } = useSidebar();
  const Icon = collapsed ? ChevronRight : ChevronLeft;

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="absolute -right-3 top-5 z-10 grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-primary shadow-md transition-colors hover:bg-background-secondary"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
