'use client';

import { ChevronDown } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Eyebrow, Tooltip, TooltipContent, TooltipTrigger } from '@bimdossier/ui';

import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';

/**
 * Renders a 2-3 letter initials block from an org name. "Acme Construction"
 * -> "AC"; "BimDossier Platform" -> "BP"; single-word "Acme" -> "Ac".
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

// Sentinel id for the org-less "Free workspace" entry in the switcher.
const FREE_WORKSPACE_ID = '__free__';

export function SidebarTenantCard(): JSX.Element | null {
  const { collapsed } = useSidebar();
  const { me, activeMembership, switchOrganization, switchToFree } = useAuth();
  const t = useTranslations('sidebar.tenant');
  const tOrgSwitcher = useTranslations('org.switcher');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const memberships = (me?.memberships ?? []).filter(
    (membership) => membership.member_status === 'active',
  );
  const isFreeContext = me != null && me.active_organization_id == null;
  // Offer the Free-workspace entry to anyone who participates in one — and
  // always while already in it (so they can switch back out).
  const showFreeOption = (me?.has_free_workspace ?? false) || isFreeContext;

  // A pure free user (no orgs, in free context) gets the trimmed sidebar with no
  // tenant card. Otherwise we need a resolved context to render.
  if (isFreeContext && memberships.length === 0) return null;
  if (!isFreeContext && activeMembership === null) return null;

  const freeLabel = tOrgSwitcher('freeWorkspace');
  const name = isFreeContext ? freeLabel : activeMembership!.organization_name;
  const acronym = initials(name);
  const ariaLabel = isFreeContext
    ? freeLabel
    : `${name} — ${seatLabel(activeMembership!.seat_count_used, activeMembership!.seat_limit)} ${t('seats')}`;

  const optionCount = memberships.length + (showFreeOption ? 1 : 0);
  const canSwitch = optionCount > 1;

  const onSelect = async (targetId: string): Promise<void> => {
    const isCurrent =
      targetId === FREE_WORKSPACE_ID ? isFreeContext : targetId === me?.active_organization_id;
    if (isCurrent) {
      setOpen(false);
      return;
    }
    setPending(targetId);
    try {
      // The switch helpers already invalidate the cache for the new context —
      // no second blanket invalidateQueries() here.
      if (targetId === FREE_WORKSPACE_ID) {
        await switchToFree();
      } else {
        await switchOrganization(targetId);
      }
    } finally {
      setPending(null);
      setOpen(false);
    }
  };

  const imageUrl = isFreeContext ? null : (activeMembership!.organization_image_url ?? null);

  if (collapsed) {
    return (
      <div className="flex justify-center px-0 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={name}
                className="h-[30px] w-[30px] cursor-pointer rounded-md object-cover"
              />
            ) : (
              <button
                type="button"
                aria-label={ariaLabel}
                className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-md bg-gradient-to-br from-sidebar-accent to-sidebar-accent-strong text-[10.5px] font-extrabold text-sidebar-fg"
              >
                {acronym}
              </button>
            )}
          </TooltipTrigger>
          <TooltipContent side="right">{ariaLabel}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 pt-3">
      <Eyebrow as="div" tone="tertiary" className="mb-1.5 px-2.5 text-sidebar-fg-muted">
        {t('label')}
      </Eyebrow>
      <div className="relative">
        <button
          type="button"
          className={`flex w-full items-center gap-[11px] rounded-lg border border-sidebar-border bg-sidebar-raised px-2.5 py-2 text-left transition-colors ${canSwitch ? 'cursor-pointer hover:bg-sidebar-hover' : 'cursor-default'}`}
          aria-label={ariaLabel}
          aria-haspopup={canSwitch ? 'listbox' : undefined}
          aria-expanded={canSwitch ? open : undefined}
          onClick={() => {
            if (canSwitch) {
              setOpen((value) => !value);
            }
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              className="h-4 w-4 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="grid h-4 w-4 shrink-0 place-items-center rounded bg-gradient-to-br from-sidebar-accent to-sidebar-accent-strong text-[8px] font-extrabold text-sidebar-fg">
              {acronym}
            </div>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-sidebar-fg">{name}</span>
          {canSwitch && <ChevronDown className="h-3 w-3 shrink-0 text-sidebar-fg-muted" />}
        </button>
        {canSwitch && open && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-sidebar-border bg-sidebar-surface py-1 shadow-lg"
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
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-sidebar-hover disabled:opacity-50 ${
                      isActive ? 'font-semibold text-sidebar-fg' : 'text-sidebar-fg-subtle'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 truncate">
                        {membership.organization_image_url ? (
                          <img
                            src={membership.organization_image_url}
                            alt=""
                            className="h-4 w-4 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-sidebar-accent text-[6px] font-extrabold text-sidebar-fg">
                            {initials(membership.organization_name)}
                          </span>
                        )}
                        <span className="truncate">{membership.organization_name}</span>
                      </span>
                      {membership.is_org_admin && (
                        <span className="rounded bg-sidebar-hover px-1.5 py-0.5 text-[10px] text-sidebar-fg-subtle">
                          {tOrgSwitcher('adminBadge')}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
            {showFreeOption && (
              <li role="option" aria-selected={isFreeContext}>
                <button
                  type="button"
                  disabled={pending === FREE_WORKSPACE_ID}
                  onClick={() => {
                    void onSelect(FREE_WORKSPACE_ID);
                  }}
                  className={`block w-full px-3 py-2 text-left text-xs hover:bg-sidebar-hover disabled:opacity-50 ${
                    isFreeContext ? 'font-semibold text-sidebar-fg' : 'text-sidebar-fg-subtle'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-sidebar-accent text-[6px] font-extrabold text-sidebar-fg">
                      {initials(freeLabel)}
                    </span>
                    <span className="truncate">{freeLabel}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
