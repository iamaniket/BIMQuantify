'use client';

import { ChevronLeft, ChevronRight } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { useSidebar } from './SidebarContext';

export function SidebarCollapseToggle(): JSX.Element {
  const { collapsed, toggle } = useSidebar();
  const t = useTranslations('sidebar');
  const Icon = collapsed ? ChevronRight : ChevronLeft;
  const label = collapsed ? t('expandSidebar') : t('collapseSidebar');

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="absolute -right-[11.5px] top-[34.5px] z-10 grid h-[22px] w-[22px] place-items-center rounded-full border border-white/12 bg-white text-primary shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-colors hover:bg-background-secondary"
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
