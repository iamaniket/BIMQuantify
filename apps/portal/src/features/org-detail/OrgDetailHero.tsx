'use client';

import { Camera, Clock, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useRef, type JSX, type ReactNode } from 'react';

import { Badge } from '@bimstitch/ui';

import { HeroShell } from '@/components/shared/layout/HeroShell';
import type { AuditEntry, MemberRead } from '@/lib/api/schemas';

import { IMAGE_ALLOWED_TYPES, IMAGE_MAX_BYTES, orgInitials, relativeTime } from './orgDetailHelpers';
import type { OrgDetailViewProps } from './types';

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function OrgDetailHero({
  org,
  members,
  auditEntries,
  actions,
  onImageUpload,
  onImageRemove,
}: {
  org: OrgDetailViewProps['org'];
  members: MemberRead[];
  auditEntries: AuditEntry[];
  actions?: ReactNode;
  onImageUpload?: (file: File) => void;
  onImageRemove?: () => void;
}): JSX.Element {
  const t = useTranslations('orgDetail.hero');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canEdit = onImageUpload !== undefined;

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;
  const totalActive = members.filter((m) => m.status !== 'removed').length;
  const unlimited = org.seatLimit === null;
  const seatPct = org.seatLimit === null ? (org.seatCountUsed > 0 ? 8 : 0) : Math.round((org.seatCountUsed / org.seatLimit) * 100);

  const storageUnlimited = org.activeStorageLimitGb === null;
  const storagePct = org.activeStorageLimitGb === null
    ? (org.activeStorageUsedGb > 0 ? 8 : 0)
    : Math.round((org.activeStorageUsedGb / org.activeStorageLimitGb) * 100);
  const storageOverLimit = org.activeStorageLimitGb !== null && org.activeStorageUsedGb >= org.activeStorageLimitGb;
  const storageBarColor = storagePct >= 95
    ? 'bg-error'
    : storagePct >= 80
      ? 'bg-warning'
      : 'bg-gradient-to-r from-primary to-primary-light';

  const lastEvent: AuditEntry | null = auditEntries.length > 0 ? auditEntries[0] ?? null : null;
  const todayCount = auditEntries.filter((e) => {
    const d = new Date(e.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <HeroShell
      image={
        <div className="group relative h-[112px] w-[160px] overflow-hidden rounded-[10px] bg-black/5 shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:bg-white/10 dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
          {org.imageUrl ? (
            <img
              src={org.imageUrl}
              alt={org.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-primary-light text-[36px] font-extrabold text-primary-foreground">
              {orgInitials(org.name)}
            </div>
          )}
          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ALLOWED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > IMAGE_MAX_BYTES) return;
                  onImageUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => fileInputRef.current?.click()}
                aria-label={org.imageUrl ? t('changeImage') : t('uploadImage')}
              >
                <Camera className="h-6 w-6 text-white" />
              </button>
              {org.imageUrl && onImageRemove && (
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                  onClick={onImageRemove}
                  aria-label={t('removeImage')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          )}
        </div>
      }
      title={org.name}
      badge={
        <Badge variant={org.status === 'active' ? 'success' : 'warning'}>
          {org.status === 'active' ? 'Active' : 'Suspended'}
        </Badge>
      }
      subtitle={
        <>
          <span>{t('members')}, {t('seats').toLowerCase()}, audit</span>
          <span className="text-foreground-tertiary/50">&middot;</span>
          <span>
            <strong className="text-primary">{adminCount}</strong> {t('admin')}
            {' · '}
            <strong className="text-foreground-secondary">{memberCount}</strong> {t('member')}
            {pendingCount > 0 && (
              <> &middot; {t('pendingInvite', { count: pendingCount })}</>
            )}
          </span>
        </>
      }
      kpis={[
        {
          label: t('seats'),
          value: `${org.seatCountUsed}`,
          sub: (
            <div className="flex flex-col gap-1">
              <span>/ {unlimited ? '∞' : org.seatLimit}</span>
              <div className="h-1 w-16 overflow-hidden rounded-full bg-background-hover">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
                  style={{ width: `${Math.min(seatPct, 100)}%` }}
                />
              </div>
            </div>
          ),
        },
        {
          label: t('storage'),
          value: `${org.activeStorageUsedGb} GB`,
          sub: (
            <div className="flex flex-col gap-1">
              <span>/ {storageUnlimited ? '∞' : `${org.activeStorageLimitGb} GB`}</span>
              <div className="h-1 w-16 overflow-hidden rounded-full bg-background-hover">
                <div
                  className={`h-full rounded-full ${storageBarColor}`}
                  style={{ width: `${Math.min(storagePct, 100)}%` }}
                />
              </div>
            </div>
          ),
        },
        {
          label: t('members'),
          value: String(totalActive),
          sub: `${t('total')}`,
        },
        {
          label: t('lastActivity'),
          value: lastEvent !== null ? relativeTime(lastEvent.created_at) : '—',
          sub: lastEvent !== null ? lastEvent.action : t('noEvents'),
        },
        {
          label: t('eventsToday', { count: todayCount }),
          value: String(todayCount),
          sub: (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {t('today')}
            </span>
          ),
        },
      ]}
      action={actions}
    />
  );
}
