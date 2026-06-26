'use client';

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  Clock,
  FileBadge,
  Layers,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge, type BadgeVariant } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { formatMonthDay } from '@/lib/formatting/dates';
import type { OrgCertificate } from '@/lib/api/schemas';
import {
  getCertificateDaysLeft,
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';

type Props = {
  certificates: OrgCertificate[];
  /** When provided, renewal rows become clickable and open the cert viewer. */
  onView?: (cert: OrgCertificate) => void;
};

const EXPIRY_COLORS: Record<CertificateExpiryState, string> = {
  valid: 'var(--success)',
  expiring: 'var(--warning)',
  expired: 'var(--error)',
  none: 'var(--foreground-tertiary)',
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

const EXPIRY_ORDER: CertificateExpiryState[] = ['valid', 'expiring', 'expired', 'none'];
const TYPE_KEYS = ['product', 'installation_test', 'inspection', 'warranty', 'other'] as const;

const RENEWAL_HORIZON_DAYS = 90;
const TREND_WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

export function OrgCertificatesOverview({ certificates, onView }: Props): JSX.Element {
  const t = useTranslations('orgCertificates');
  const locale = useLocale() as Locale;

  const total = certificates.length;

  const byType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const k of TYPE_KEYS) counts[k] = 0;
    for (const c of certificates) {
      counts[c.certificate_type] = (counts[c.certificate_type] ?? 0) + 1;
    }
    return counts;
  }, [certificates]);

  const byExpiry = useMemo(() => {
    const counts: Record<CertificateExpiryState, number> = {
      none: 0, valid: 0, expiring: 0, expired: 0,
    };
    for (const c of certificates) {
      counts[getCertificateExpiryState(c.valid_until)] += 1;
    }
    return counts;
  }, [certificates]);

  const expirySegments = useMemo<DonutSegment[]>(
    () => EXPIRY_ORDER.map((state) => ({
      value: byExpiry[state],
      color: EXPIRY_COLORS[state],
      label: t(`expiry.${state}`),
    })),
    [byExpiry, t],
  );

  const typeCategories = useMemo(() => TYPE_KEYS.map((k) => t(`type.${k}`)), [t]);
  const typeValues = useMemo(() => TYPE_KEYS.map((k) => byType[k] ?? 0), [byType]);

  // Certificates added per week over the last TREND_WEEKS weeks.
  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const start = today.getTime() - (TREND_WEEKS - 1) * MS_WEEK;
    const values = new Array<number>(TREND_WEEKS).fill(0);
    for (const c of certificates) {
      const ts = new Date(c.created_at).getTime();
      if (!Number.isNaN(ts)) {
        let idx = Math.floor((ts - start) / MS_WEEK);
        if (idx >= TREND_WEEKS) idx = TREND_WEEKS - 1; // clamp future-dated
        if (idx >= 0) values[idx] = (values[idx] ?? 0) + 1;
      }
    }
    const labels = values.map(
      (_, i) => formatMonthDay(new Date(start + i * MS_WEEK).toISOString(), locale),
    );
    return { values, labels };
  }, [certificates, locale]);

  // Renewals due: dated certs expiring within the horizon (or already expired).
  const renewals = useMemo(() => {
    const rows: { cert: OrgCertificate; daysLeft: number }[] = [];
    for (const cert of certificates) {
      const daysLeft = getCertificateDaysLeft(cert.valid_until);
      if (daysLeft !== null && daysLeft <= RENEWAL_HORIZON_DAYS) rows.push({ cert, daysLeft });
    }
    rows.sort((a, b) => a.daysLeft - b.daysLeft);
    return rows;
  }, [certificates]);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('overview.totalCerts')}
          value={total}
          icon={<FileBadge className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('overview.validCerts')}
          value={byExpiry.valid}
          icon={<CheckCircle className="h-3.5 w-3.5" aria-hidden />}
          accent="success"
        />
        <StatCard
          label={t('overview.expiringSoonCerts')}
          value={byExpiry.expiring}
          sub={t('overview.expiringSoonSub')}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          accent="warning"
        />
        <StatCard
          label={t('overview.expiredCerts')}
          value={byExpiry.expired}
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          accent="error"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Expiry status donut + legend */}
        <ChartSection icon={<Clock className="h-3.5 w-3.5" aria-hidden />} title={t('overview.byExpiryTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.empty')}</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={expirySegments}
                centerValue={String(total)}
                centerLabel={t('overview.donutCenterLabel')}
                size={180}
              />
              <ul className="flex min-w-0 flex-1 flex-col gap-2">
                {EXPIRY_ORDER.map((state) => (
                  <li key={state} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: EXPIRY_COLORS[state] }} />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{t(`expiry.${state}`)}</span>
                    <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{byExpiry[state]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartSection>

        {/* Certificates by type */}
        <ChartSection icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('overview.byTypeTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.empty')}</p>
          ) : (
            <BarChartMini categories={typeCategories} values={typeValues} height={200} />
          )}
        </ChartSection>

        {/* Added over time */}
        <ChartSection
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          title={t('overview.trendTitle')}
          className="lg:col-span-2"
        >
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.trendEmpty')}</p>
          ) : (
            <TrendArea values={trend.values} labels={trend.labels} height={200} />
          )}
        </ChartSection>

        {/* Renewals due */}
        <ChartSection
          icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
          title={t('overview.renewalsTitle')}
          className="lg:col-span-2"
        >
          {renewals.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.renewalsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {renewals.map(({ cert, daysLeft }) => {
                const state = getCertificateExpiryState(cert.valid_until);
                const overdue = daysLeft < 0;
                const name = cert.product_name !== null && cert.product_name !== ''
                  ? cert.product_name
                  : cert.original_filename;
                return (
                  <li key={cert.id}>
                    <button
                      type="button"
                      onClick={() => { if (onView !== undefined) onView(cert); }}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">
                        {name}
                        {cert.supplier_name !== null && cert.supplier_name !== '' && (
                          <span className="ml-2 font-sans text-caption font-normal text-foreground-tertiary">{cert.supplier_name}</span>
                        )}
                      </span>
                      <Badge variant={EXPIRY_BADGE[state]} size="md" bordered>{t(`expiry.${state}`)}</Badge>
                      <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${overdue ? 'text-error' : 'text-foreground-tertiary'}`}>
                        {overdue ? t('expiry.expired') : t('overview.daysLeft', { n: daysLeft })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartSection>
      </div>
    </div>
  );
}
