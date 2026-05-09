'use client';

import { ChevronDown } from 'lucide-react';
import type { JSX } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

import { useSidebar } from './SidebarContext';

export function SidebarTenantCard(): JSX.Element {
  const { collapsed } = useSidebar();

  if (collapsed) {
    return (
      <div className="flex justify-center px-0 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Heijmans Bouw N.V. — Enterprise"
              className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-md bg-gradient-to-br from-[#5fa8ff] to-[#2c5697] text-[10.5px] font-extrabold text-white"
            >
              HBN
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Heijmans Bouw N.V. — Enterprise</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 pt-3">
      <div className="mb-1.5 px-2.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/55">
        Tenant
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-white/10"
      >
        <div className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-gradient-to-br from-[#5fa8ff] to-[#2c5697] text-[10px] font-extrabold text-white">
          HBN
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-white">
            Heijmans Bouw N.V.
          </div>
          <div className="mt-px text-[10px] font-medium text-white/55">
            Enterprise · 47 seats
          </div>
        </div>
        <ChevronDown className="h-3 w-3 shrink-0 text-white/55" />
      </button>
    </div>
  );
}
