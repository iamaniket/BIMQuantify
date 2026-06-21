'use client';

import { ChevronRight, Download, Key, Settings, Shield, Trash2, UserPlus } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
} from '@bimstitch/ui';

import type { AuditEntry, MemberRead } from '@/lib/api/schemas';

import { relativeTime } from './orgDetailHelpers';
import type { OrgDetailViewProps } from './types';

// ---------------------------------------------------------------------------
// Overview pane
// ---------------------------------------------------------------------------

export function OverviewPane({
  org,
  members,
  auditEntries,
  onInvite,
  onSwitchTab,
  extraQuickActions,
  onDelete,
}: {
  org: OrgDetailViewProps['org'];
  members: MemberRead[];
  auditEntries: AuditEntry[];
  onInvite: () => void;
  onSwitchTab: (tab: string) => void;
  extraQuickActions?: ReactNode;
  onDelete?: (() => void) | undefined;
}): JSX.Element {
  const t = useTranslations('orgDetail.overview');
  const unlimited = org.seatLimit === null;
  const gridTotal = 20;
  const cells = Array.from({ length: gridTotal }, (_, i) => (i < org.seatCountUsed ? 'used' : 'available'));

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  const recentEvents = auditEntries.slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-body2 font-bold">{t('seatUsageTitle')}</h3>
            <Badge variant="info">
              <Key className="mr-1 h-3 w-3" />
              {unlimited ? t('unlimited') : `${org.seatLimit} seats`}
            </Badge>
          </CardHeader>
          <CardBody>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-h4 font-extrabold tracking-tight">
                {org.seatCountUsed}
                <span className="ml-1 text-body1 font-medium text-foreground-tertiary">
                  {t('seatsInUse', { count: org.seatCountUsed })}
                </span>
              </div>
              <div className="text-body3 text-foreground-tertiary">
                {t('showingOf', { shown: gridTotal, total: unlimited ? '∞' : String(org.seatLimit) })}
              </div>
            </div>
            <div className="grid grid-cols-[repeat(20,1fr)] gap-1.5">
              {cells.map((c, i) => (
                <div
                  key={i}
                  className={
                    c === 'used'
                      ? 'aspect-square rounded-sm bg-gradient-to-br from-primary to-primary-light shadow-[inset_0_0_0_1px_rgba(44,86,151,0.25)]'
                      : unlimited
                        ? 'aspect-square rounded-sm bg-[repeating-linear-gradient(45deg,var(--background-tertiary)_0,var(--background-tertiary)_3px,var(--background-hover)_3px,var(--background-hover)_6px)]'
                        : 'aspect-square rounded-sm bg-background-hover'
                  }
                />
              ))}
            </div>
            <div className="mt-3.5 flex gap-4 text-body3 text-foreground-tertiary">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-primary to-primary-light" />
                {t('assigned')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-background-hover" />
                {unlimited ? t('availableUnlimited') : t('available')}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-body2 font-bold">{t('recentActivityTitle')}</h3>
            <button
              type="button"
              className="text-body3 font-semibold text-primary hover:underline"
              onClick={() => { onSwitchTab('audit'); }}
            >
              {t('viewAuditLog')} →
            </button>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            {recentEvents.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
                No recent activity
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentEvents.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[28px_1fr_auto] items-start gap-3 px-5 py-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                      {entry.action.startsWith('auth.') ? (
                        <Shield className="h-3.5 w-3.5" />
                      ) : entry.action.includes('invite') || entry.action.includes('member') ? (
                        <UserPlus className="h-3.5 w-3.5" />
                      ) : (
                        <Settings className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="text-body3 text-foreground-secondary">
                      <span className="font-semibold text-foreground">{entry.resource_type}</span>{' '}
                      <span className="text-foreground-tertiary">{entry.action}</span>
                    </div>
                    <div className="font-sans text-body3 text-foreground-tertiary">
                      {relativeTime(entry.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{t('membersByRoleTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                  <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                  Admin
                </div>
                <div className="font-sans text-body3 text-foreground-tertiary">
                  {adminCount} <span className="text-foreground-tertiary">&middot; {t('fullAccess')}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                  <span className="h-2.5 w-2.5 rounded-sm bg-foreground-tertiary" />
                  Member
                </div>
                <div className="font-sans text-body3 text-foreground-tertiary">
                  {memberCount} <span className="text-foreground-tertiary">&middot; {t('readWrite')}</span>
                </div>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <div className="flex items-center gap-2.5 text-body3 font-medium text-warning">
                    <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
                    {t('pendingInvite')}
                  </div>
                  <div className="font-sans text-body3 text-foreground-tertiary">{pendingCount}</div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{t('quickActionsTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0.5 p-2">
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
              onClick={onInvite}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <UserPlus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{t('inviteMember')}</div>
                <div className="text-caption text-foreground-tertiary">{t('inviteMemberSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <Download className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{t('exportData')}</div>
                <div className="text-caption text-foreground-tertiary">{t('exportDataSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
            {extraQuickActions}
          </CardBody>
        </Card>

        {onDelete !== undefined && (
          <Card className="border-error-light">
            <CardHeader className="border-b-error-light bg-error-lighter">
              <div className="flex items-center justify-between">
                <h3 className="text-body2 font-bold text-error">{t('dangerZoneTitle')}</h3>
                <Trash2 className="h-3.5 w-3.5 text-error" />
              </div>
            </CardHeader>
            <CardBody>
              <p className="mb-3.5 text-body3 leading-relaxed text-foreground-tertiary">
                {t('dangerZoneDesc')}
              </p>
              <Button
                variant="border"
                size="md"
                className="border-error-light text-error hover:bg-error-lighter"
                onClick={onDelete}
              >
                {t('deleteOrg')}
              </Button>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
