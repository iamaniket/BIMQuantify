'use client';

import { Box, ClipboardCheck, Download, Eye, FileBadge, Glasses, ShieldCheck, Trash2, Upload } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, type ComponentType, type JSX } from 'react';
import { toast } from 'sonner';

import type { Locale } from '@bimstitch/i18n';

import {
  Badge,
  CountChip,
  DetailCard,
  DetailCardBody,
  DetailCardRow,
  MetaGrid,
  type BadgeVariant,
} from '@bimstitch/ui';

import { ResourceMediaTile, VersionHistoryList, type MediaTileTone } from '@/components/shared/resource';
import { RowActionPill } from '@/components/shared/resource/RowActionPill';
import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import { formatDate } from '@/lib/formatting/dates';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { useCertificateVersions } from '@/features/certificates/useCertificateVersions';
import { useAuth } from '@/providers/AuthProvider';

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

const TYPE_ICON: Record<CertificateTypeValue, { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; tone: MediaTileTone }> = {
  product: { icon: Box, tone: 'neutral' },
  installation_test: { icon: ClipboardCheck, tone: 'info' },
  inspection: { icon: Glasses, tone: 'warning' },
  warranty: { icon: ShieldCheck, tone: 'success' },
  other: { icon: FileBadge, tone: 'neutral' },
};

type Props = {
  projectId: string;
  certificate: Certificate;
  expanded: boolean;
  canUpload: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onView: (certificate: Certificate) => void;
  onSupersede: (certificate: Certificate) => void;
  onDelete: (certificate: Certificate) => void;
  deleteDisabled: boolean;
};

export function CertificateRow({
  projectId,
  certificate,
  expanded,
  canUpload,
  canDelete,
  onToggle,
  onView,
  onSupersede,
  onDelete,
  deleteDisabled,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const tVer = useTranslations('common.versions');
  const locale = useLocale() as Locale;
  const { tokens } = useAuth();

  const hasVersions = certificate.version_number > 1;
  const versionsQuery = useCertificateVersions(
    projectId,
    expanded && hasVersions ? certificate.id : null,
  );

  const handleDownload = useCallback(
    async (id: string) => {
      if (tokens === null) return;
      try {
        const resp = await getCertificateDownloadUrl(tokens.access_token, projectId, id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(t('downloadError'));
      }
    },
    [tokens, projectId, t],
  );

  const expiryState = getCertificateExpiryState(certificate.valid_until);

  const entries: Array<{ label: string; value: string }> = [
    { label: t('expandedType'), value: t(`type.${certificate.certificate_type}`) },
  ];
  if (certificate.issuer !== null && certificate.issuer !== '') {
    entries.push({ label: t('expandedIssuer'), value: certificate.issuer });
  }
  if (certificate.certificate_number !== null && certificate.certificate_number !== '') {
    entries.push({ label: t('expandedNumber'), value: certificate.certificate_number });
  }
  if (certificate.valid_from !== null) {
    entries.push({ label: t('expandedValidFrom'), value: formatDate(certificate.valid_from, locale) });
  }
  entries.push({ label: t('expandedValidUntil'), value: formatDate(certificate.valid_until, locale) });
  entries.push({ label: t('expandedAdded'), value: formatDate(certificate.created_at, locale) });

  const versionEntries = (versionsQuery.data ?? []).map((v) => ({
    id: v.id,
    versionNumber: v.version_number,
    filename: v.original_filename,
    sizeBytes: v.size_bytes,
    createdAt: v.created_at,
    uploadedByName: v.uploaded_by_name,
  }));

  return (
    <DetailCard expanded={expanded} onToggle={onToggle}>
      <DetailCardRow
        media={<ResourceMediaTile icon={TYPE_ICON[certificate.certificate_type].icon} tone={TYPE_ICON[certificate.certificate_type].tone} />}
        info={certificate.version_number > 1 ? (
          <CountChip className="rounded-full bg-surface-high px-2 py-0.5 font-semibold">
            {tVer('badge', { n: certificate.version_number })}
          </CountChip>
        ) : undefined}
        actions={
          <>
            <RowActionPill
              size="md"
              icon={<Eye className="h-3.5 w-3.5" />}
              label={t('rowView')}
              title={t('rowView')}
              onClick={() => { onView(certificate); }}
            />
            <RowActionPill
              size="md"
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('download')}
              title={t('download')}
              onClick={() => { void handleDownload(certificate.id); }}
            />
          </>
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-body3 font-semibold leading-tight text-foreground">
            {certificate.original_filename}
          </span>
          <Badge variant="default" size="md" bordered>
            {t(`type.${certificate.certificate_type}`)}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          {certificate.issuer !== null && certificate.issuer !== '' && (
            <>
              <span className="shrink-0">{certificate.issuer}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          <span className="shrink-0">{t('validUntilShort', { date: formatDate(certificate.valid_until, locale) })}</span>
          <span className="shrink-0">·</span>
          <Badge variant={EXPIRY_BADGE[expiryState]} size="md" bordered>
            {t(`expiry.${expiryState}`)}
          </Badge>
        </div>
      </DetailCardRow>

      <DetailCardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <RowActionPill
              size="md"
              icon={<Eye className="h-3.5 w-3.5" />}
              label={t('rowView')}
              onClick={() => { onView(certificate); }}
            />
            <RowActionPill
              size="md"
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('download')}
              onClick={() => { void handleDownload(certificate.id); }}
            />
            {canUpload && (
              <RowActionPill
                size="md"
                icon={<Upload className="h-3.5 w-3.5" />}
                label={t('uploadNewVersion')}
                onClick={() => { onSupersede(certificate); }}
              />
            )}
          </div>
          {canDelete && (
            <RowActionPill
              tone="danger"
              size="md"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={t('expandedRemove')}
              disabled={deleteDisabled}
              onClick={() => { onDelete(certificate); }}
            />
          )}
        </div>
        {certificate.description !== null && certificate.description !== '' && (
          <div className="whitespace-pre-wrap border-b border-dashed border-border py-2.5 text-body3 leading-snug text-foreground-secondary">
            {certificate.description}
          </div>
        )}
        <MetaGrid entries={entries} />
        {hasVersions && (
          <VersionHistoryList
            versions={versionEntries}
            isLoading={versionsQuery.isLoading}
            onDownload={(id) => { void handleDownload(id); }}
          />
        )}
      </DetailCardBody>
    </DetailCard>
  );
}
