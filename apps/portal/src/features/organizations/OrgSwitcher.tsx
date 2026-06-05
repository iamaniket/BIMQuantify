'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@bimstitch/ui';

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
  const [pending, setPending] = useState<string | null>(null);

  if (me === null) return null;
  const memberships = me.memberships.filter((m) => m.member_status === 'active');
  if (memberships.length < 2) return null;

  const onSelect = async (organizationId: string): Promise<void> => {
    if (organizationId === me.active_organization_id) return;
    setPending(organizationId);
    try {
      await switchOrganization(organizationId);
      // Invalidate everything — tenant-scoped queries are now stale in the
      // new org's schema.
      await queryClient.invalidateQueries();
    } finally {
      setPending(null);
    }
  };

  const label = activeMembership?.organization_name ?? t('empty');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-body2 font-medium text-foreground transition-colors hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('label')}
      >
        <span className="max-w-[16ch] truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-64 overflow-auto">
        {memberships.map((m) => {
          const isActive = m.organization_id === me.active_organization_id;
          const isPending = pending === m.organization_id;
          return (
            <DropdownMenuItem
              key={m.organization_id}
              disabled={isPending}
              onSelect={(event) => {
                event.preventDefault();
                void onSelect(m.organization_id);
              }}
              className={isActive ? 'font-semibold' : undefined}
            >
              <span className="flex-1 truncate">{m.organization_name}</span>
              {m.is_org_admin && (
                <Badge variant="default" size="sm" bordered={false}>
                  {t('adminBadge')}
                </Badge>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
