'use client';

import { CheckCircle, FileBadge, Clock } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge, type BadgeVariant } from '@bimstitch/ui';

import type { OrgCertificate } from '@/lib/api/schemas';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';

type Props = {
  certificates: OrgCertificate[];
};

const EXPIRY_COLOR: Record<CertificateExpiryState, string> = {
  none: 'bg-foreground-tertiary',
  valid: 'bg-success',
  expiring: 'bg-warning',
  expired: 'bg-error',
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

const TYPE_KEYS = ['product', 'installation_test', 'inspection', 'warranty', 'other'] as const;

export function OrgCertificatesOverview({ certificates }: Props): JSX.Element {
  const t = useTranslations('orgCertificates');

  const byType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const k of TYPE_KEYS) counts[k] = 0;
    for (const c of certificates) {
      counts[c.certificate_type] = (counts[c.certificate_type] ?? 0) + 1;
    }
    return counts;
  }, [certificates]);

  const byExpiry = useMemo(() => {
    const counts: Record<CertificateExpiryState, number> = { none: 0, valid: 0, expiring: 0, expired: 0 };
    for (const c of certificates) {
      const state = getCertificateExpiryState(c.valid_until);
      counts[state]++;
    }
    return counts;
  }, [certificates]);

  const recent = useMemo(
    () =>
      [...certificates]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    [certificates],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <FileBadge className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{certificates.length}</div>
              <div className="text-caption text-foreground-tertiary">{t('overview.totalCerts')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-lighter text-success">
              <CheckCircle className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{byExpiry.valid}</div>
              <div className="text-caption text-foreground-tertiary">{t('overview.validCerts')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning-lighter text-warning">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{byExpiry.expiring}</div>
              <div className="text-caption text-foreground-tertiary">{t('overview.expiringSoonCerts')}</div>
            </div>
          </div>
        </div>
      </div>

    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('overview.byTypeTitle')}</h3>
        <div className="space-y-3">
          {TYPE_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-body3 font-medium text-foreground-secondary">
                {t(`type.${key}`)}
              </span>
              <span className="font-sans text-body3 text-foreground-tertiary tabular-nums">
                {byType[key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('overview.byExpiryTitle')}</h3>
        <div className="space-y-3">
          {(['valid', 'expiring', 'expired', 'none'] as const).map((state) => (
            <div key={state} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                <span className={`h-2.5 w-2.5 rounded-sm ${EXPIRY_COLOR[state]}`} />
                {t(`expiry.${state}`)}
              </div>
              <span className="font-sans text-body3 text-foreground-tertiary tabular-nums">
                {byExpiry[state]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-low p-5 xl:col-span-2">
        <h3 className="mb-4 text-body2 font-bold">{t('overview.recentTitle')}</h3>
        {recent.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{t('list.emptyTitle')}</p>
        ) : (
          <div className="divide-y divide-border">
            {recent.map((cert) => {
              const expiryState = getCertificateExpiryState(cert.valid_until);
              return (
                <div key={cert.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="text-body3 font-medium">
                      {cert.product_name !== null && cert.product_name !== ''
                        ? cert.product_name
                        : cert.original_filename}
                    </span>
                    {cert.supplier_name !== null && cert.supplier_name !== '' && (
                      <span className="ml-2 font-sans text-caption text-foreground-tertiary">
                        {cert.supplier_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={EXPIRY_BADGE[expiryState]} size="md" bordered>
                      {t(`expiry.${expiryState}`)}
                    </Badge>
                    <span className="text-caption text-foreground-tertiary tabular-nums">
                      {new Date(cert.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
