'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { useAuth } from '@/providers/AuthProvider';

/**
 * Top-bar organization switcher.
 *
 * Hidden when the user has fewer than two memberships — there's nothing to
 * switch between, and the chrome stays cleaner for the common single-org
 * case. When a user does belong to multiple orgs, the pill becomes a
 * dropdown that re-mints tokens via /auth/switch-organization on select
 * and invalidates the React Query cache so tenant-scoped queries refetch.
 */
export function OrgSwitcher(): JSX.Element | null {
  const t = useTranslations('org.switcher');
  const { me, activeMembership, switchOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (me === null) return null;
  const memberships = me.memberships.filter((m) => m.member_status === 'active');
  if (memberships.length < 2) return null;

  const onSelect = async (organizationId: string): Promise<void> => {
    if (organizationId === me.active_organization_id) {
      setOpen(false);
      return;
    }
    setPending(organizationId);
    try {
      await switchOrganization(organizationId);
      // Invalidate everything — tenant-scoped queries are now stale in the
      // new org's schema.
      await queryClient.invalidateQueries();
    } finally {
      setPending(null);
      setOpen(false);
    }
  };

  const label = activeMembership?.organization_name ?? t('empty');

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('label')}
      >
        <span className="truncate max-w-[16ch]">{label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {memberships.map((m) => {
            const isActive = m.organization_id === me.active_organization_id;
            const isPending = pending === m.organization_id;
            return (
              <li key={m.organization_id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    void onSelect(m.organization_id);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 ${
                    isActive ? 'font-semibold text-slate-900' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.organization_name}</span>
                    {m.is_org_admin && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {t('adminBadge')}
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
  );
}
