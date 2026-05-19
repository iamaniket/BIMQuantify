'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';

/**
 * Renders a 2-3 letter initials block from an org name. "Acme Construction"
 * -> "AC"; "BIMstitch Platform" -> "BP"; single-word "Acme" -> "Ac".
 */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0]!;
    return (w.slice(0, 2)).toUpperCase();
  }
  return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join('');
}

function seatLabel(used: number, limit: number | null): string {
  if (limit === null) return `${used} / ∞`;
  return `${used} / ${limit}`;
}

export function SidebarTenantCard(): JSX.Element | null {
  const { collapsed } = useSidebar();
  const { activeMembership } = useAuth();
  const t = useTranslations('sidebar.tenant');

  if (activeMembership === null) return null;

  const name = activeMembership.organization_name;
  const used = activeMembership.seat_count_used;
  const limit = activeMembership.seat_limit;
  const acronym = initials(name);
  const ariaLabel = `${name} — ${seatLabel(used, limit)} ${t('seats')}`;

  if (collapsed) {
    return (
      <div className="flex justify-center px-0 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-md bg-gradient-to-br from-[#5fa8ff] to-[#2c5697] text-[10.5px] font-extrabold text-white"
            >
              {acronym}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{ariaLabel}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 pt-3">
      <div className="mb-1.5 px-2.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/55">
        {t('label')}
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-white/10"
        aria-label={ariaLabel}
      >
        <div className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-gradient-to-br from-[#5fa8ff] to-[#2c5697] text-[10px] font-extrabold text-white">
          {acronym}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-white">{name}</div>
          <div className="mt-px text-[10px] font-medium text-white/55">
            {seatLabel(used, limit)} {t('seats')}
          </div>
        </div>
        <ChevronDown className="h-3 w-3 shrink-0 text-white/55" />
      </button>
    </div>
  );
}
