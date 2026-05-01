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
            <div className="grid h-8 w-8 cursor-pointer place-items-center rounded-md bg-gradient-to-br from-blue-400 to-primary text-caption font-extrabold text-white">
              HBN
            </div>
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
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/12 bg-white/5 px-2.5 py-2 text-left transition-colors hover:bg-white/10"
      >
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-blue-400 to-primary text-[10px] font-extrabold text-white">
          HBN
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body3 font-semibold text-white">
            Heijmans Bouw N.V.
          </div>
          <div className="mt-0.5 text-caption font-medium text-white/55">
            Enterprise · 47 seats
          </div>
        </div>
        <ChevronDown className="h-3 w-3 shrink-0 text-white/55" />
      </button>
    </div>
  );
}
