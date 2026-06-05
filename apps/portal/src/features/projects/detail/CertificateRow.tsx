'use client';

import { Download, Eye, FileBadge, Trash2, Upload } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
  MetaGrid,
  type BadgeVariant,
} from '@bimstitch/ui';

import { ResourceMediaTile, VersionBadge, VersionHistoryList } from '@/components/shared/resource';
import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import type { Certificate } from '@/lib/api/schemas';
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

function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  return value.slice(0, 10);
}

type Props = {
  projectId: string;
  certificate: Certificate;
  expanded: boolean;
  canUpload: boolean;
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
  onToggle,
  onView,
  onSupersede,
  onDelete,
  deleteDisabled,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
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
    entries.push({ label: t('expandedValidFrom'), value: formatDate(certificate.valid_from) });
  }
  entries.push({ label: t('expandedValidUntil'), value: formatDate(certificate.valid_until) });
  entries.push({ label: t('expandedAdded'), value: formatDate(certificate.created_at) });

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
        media={<ResourceMediaTile icon={FileBadge} tone="neutral" />}
        actions={
          <>
            <button
              type="button"
              title={t('rowView')}
              onClick={(e) => { e.stopPropagation(); onView(certificate); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('download')}
              onClick={(e) => { e.stopPropagation(); void handleDownload(certificate.id); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-body3 font-semibold leading-tight text-foreground">
            {certificate.original_filename}
          </span>
          <Badge variant="default" size="sm" bordered>
            {t(`type.${certificate.certificate_type}`)}
          </Badge>
          <VersionBadge version={certificate.version_number} />
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          {certificate.issuer !== null && certificate.issuer !== '' && (
            <>
              <span className="shrink-0">{certificate.issuer}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          <span className="shrink-0">{t('validUntilShort', { date: formatDate(certificate.valid_until) })}</span>
          <span className="shrink-0">·</span>
          <Badge variant={EXPIRY_BADGE[expiryState]} size="sm" bordered>
            {t(`expiry.${expiryState}`)}
          </Badge>
        </div>
      </DetailCardRow>

      <DetailCardBody>
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

      <DetailCardFooter className="justify-between">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => { onView(certificate); }}>
            <Eye className="h-3.5 w-3.5" />
            {t('rowView')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { void handleDownload(certificate.id); }}>
            <Download className="h-3.5 w-3.5" />
            {t('download')}
          </Button>
          {canUpload && (
            <Button variant="ghost" size="sm" onClick={() => { onSupersede(certificate); }}>
              <Upload className="h-3.5 w-3.5" />
              {t('uploadNewVersion')}
            </Button>
          )}
        </div>
        {canUpload && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { onDelete(certificate); }}
            disabled={deleteDisabled}
            className="text-error hover:text-error"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('expandedRemove')}
          </Button>
        )}
      </DetailCardFooter>
    </DetailCard>
  );
}
