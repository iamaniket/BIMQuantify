'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

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
  const { me, activeMembership, switchOrganization } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations('sidebar.tenant');
  const tOrgSwitcher = useTranslations('org.switcher');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (activeMembership === null) return null;

  const memberships = (me?.memberships ?? []).filter(
    (membership) => membership.member_status === 'active',
  );
  const canSwitch = memberships.length > 1;

  const name = activeMembership.organization_name;
  const used = activeMembership.seat_count_used;
  const limit = activeMembership.seat_limit;
  const acronym = initials(name);
  const ariaLabel = `${name} — ${seatLabel(used, limit)} ${t('seats')}`;

  const onSelect = async (organizationId: string): Promise<void> => {
    if (organizationId === me?.active_organization_id) {
      setOpen(false);
      return;
    }
    setPending(organizationId);
    try {
      await switchOrganization(organizationId);
      await queryClient.invalidateQueries();
    } finally {
      setPending(null);
      setOpen(false);
    }
  };

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
      <div className="relative">
        <button
          type="button"
          className={`flex w-full items-center gap-[11px] rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-2 text-left transition-colors ${canSwitch ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}`}
          aria-label={ariaLabel}
          aria-haspopup={canSwitch ? 'listbox' : undefined}
          aria-expanded={canSwitch ? open : undefined}
          onClick={() => {
            if (canSwitch) {
              setOpen((value) => !value);
            }
          }}
        >
          <div className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-gradient-to-br from-[#5fa8ff] to-[#2c5697] text-[8px] font-extrabold text-white">
            {acronym}
          </div>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{name}</span>
          {canSwitch && <ChevronDown className="h-3 w-3 shrink-0 text-white/55" />}
        </button>
        {canSwitch && open && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-white/12 bg-[#254a82] py-1 shadow-lg"
          >
            {memberships.map((membership) => {
              const isActive = membership.organization_id === me?.active_organization_id;
              const isPending = pending === membership.organization_id;
              return (
                <li key={membership.organization_id} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      void onSelect(membership.organization_id);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-white/10 disabled:opacity-50 ${
                      isActive ? 'font-semibold text-white' : 'text-white/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{membership.organization_name}</span>
                      {membership.is_org_admin && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80">
                          {tOrgSwitcher('adminBadge')}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
