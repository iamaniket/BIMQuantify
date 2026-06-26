'use client';

import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimdossier/i18n';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Spinner, type BadgeVariant } from '@bimdossier/ui';

import {
  DocumentViewerDialog,
  NoPreview,
  type MetaGroupSpec,
  type MetaRow,
} from '@/components/shared/DocumentViewerDialog';

import { formatDateFull, formatSize } from '@/features/attachments/attachmentMeta';
import { formatDate } from '@/lib/formatting/dates';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { useCertificateViewUrl } from '@/features/certificates/useCertificateViewUrl';
import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import { getOrgCertificateDownloadUrl, getOrgCertificateViewUrl } from '@/lib/api/orgCertificates';
import type { Certificate, OrgCertificate } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

type Props = {
  certificate: Certificate | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type OrgProps = {
  certificate: OrgCertificate | null;
  projectId?: undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

type FileLike = { content_type: string; original_filename: string };

function isImage(c: FileLike): boolean {
  return c.content_type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(c.original_filename);
}

function isPdf(c: FileLike): boolean {
  return c.content_type === 'application/pdf' || /\.pdf$/i.test(c.original_filename);
}

// ─── Media stage ─────────────────────────────────────────────────────

function CertificatePreview({
  certificate,
  viewUrl,
  isLoading,
  loadingLabel,
  noPreviewLabel,
}: {
  certificate: FileLike;
  viewUrl: string | undefined;
  isLoading: boolean;
  loadingLabel: string;
  noPreviewLabel: string;
}): JSX.Element {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-body3 text-foreground-tertiary">
          <Spinner className="mx-auto mb-2 text-primary" />
          {loadingLabel}
        </div>
      </div>
    );
  }

  if (viewUrl === undefined) {
    return <NoPreview filename={certificate.original_filename} label={noPreviewLabel} />;
  }

  if (isImage(certificate)) {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={viewUrl}
          alt={certificate.original_filename}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (isPdf(certificate)) {
    return (
      <iframe
        src={`${viewUrl}#toolbar=0`}
        title={certificate.original_filename}
        className="h-full w-full border-0"
      />
    );
  }

  return <NoPreview filename={certificate.original_filename} label={noPreviewLabel} />;
}

// ─── Dialog ──────────────────────────────────────────────────────────

/**
 * Previews a certificate (PDF / image) in the shared {@link DocumentViewerDialog}
 * shell — media stage on the left, a grouped metadata rail on the right — so it
 * reads identically to the attachment / report viewers. The rail surfaces the
 * conformity fields (type, number, issuer, subject, the validity window and an
 * expiry badge) that make a certificate more than just a file.
 */
export function CertificateViewerDialog({
  certificate,
  projectId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('viewerCertificates');
  const tType = useTranslations('projectDetail.tabs.certificates.type');
  const tExpiry = useTranslations('projectDetail.tabs.certificates.expiry');
  const locale = useLocale() as Locale;
  const { tokens } = useAuth();

  const viewUrlQuery = useCertificateViewUrl(
    projectId,
    open && certificate !== null ? certificate.id : null,
  );
  const viewUrl = viewUrlQuery.data !== undefined ? viewUrlQuery.data.download_url : undefined;

  const handleDownload = useCallback(async () => {
    if (tokens === null || certificate === null) return;
    try {
      const { download_url: downloadUrl } = await getCertificateDownloadUrl(
        tokens.access_token,
        projectId,
        certificate.id,
      );
      window.open(downloadUrl, '_blank');
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, projectId, certificate, t]);

  if (certificate === null) {
    return (
      <DocumentViewerDialog
        open={false}
        onOpenChange={onOpenChange}
        title=""
        subtitle=""
        preview={null}
        metaGroups={[]}
        footerInfo=""
        closeLabel={t('viewerClose')}
      />
    );
  }

  const expiry = getCertificateExpiryState(certificate.valid_until);

  // ── File ──
  const fileRows: MetaRow[] = [
    { label: t('fieldFilename'), value: certificate.original_filename, mono: true },
    { label: t('fieldSize'), value: formatSize(certificate.size_bytes), mono: true },
    { label: t('fieldFileType'), value: certificate.content_type, mono: true },
  ];

  // ── Certificate (the conformity metadata) ──
  const certRows: MetaRow[] = [
    { label: t('fieldType'), value: tType(certificate.certificate_type) },
  ];
  if (certificate.certificate_number !== null && certificate.certificate_number !== '') {
    certRows.push({ label: t('fieldNumber'), value: certificate.certificate_number, mono: true });
  }
  if (certificate.issuer !== null && certificate.issuer !== '') {
    certRows.push({ label: t('fieldIssuer'), value: certificate.issuer });
  }
  if (certificate.subject !== null && certificate.subject !== '') {
    certRows.push({ label: t('fieldSubject'), value: certificate.subject });
  }
  if (certificate.valid_from !== null) {
    certRows.push({ label: t('fieldValidFrom'), value: formatDate(certificate.valid_from, locale), mono: true });
  }
  certRows.push({ label: t('fieldValidUntil'), value: formatDate(certificate.valid_until, locale), mono: true });
  certRows.push({
    label: t('fieldStatus'),
    value: (
      <Badge variant={EXPIRY_BADGE[expiry]} size="md" bordered>
        {tExpiry(expiry)}
      </Badge>
    ),
  });

  // ── Origin ──
  const originRows: MetaRow[] = [
    { label: t('fieldUploadedAt'), value: formatDateFull(certificate.created_at, locale), mono: true },
  ];
  if (certificate.uploaded_by_name !== null) {
    originRows.push({ label: t('fieldUploadedBy'), value: certificate.uploaded_by_name });
  }
  const uploadedByText = certificate.uploaded_by_name ?? '—';

  const metaGroups: MetaGroupSpec[] = [
    { title: t('groupFile'), rows: fileRows },
    { title: t('groupCertificate'), rows: certRows },
    { title: t('groupOrigin'), rows: originRows },
  ];

  return (
    <DocumentViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('viewerTitle')}
      subtitle={t('viewerSubtitle')}
      imageStage={isImage(certificate)}
      preview={(
        <CertificatePreview
          certificate={certificate}
          viewUrl={viewUrl}
          isLoading={viewUrlQuery.isLoading}
          loadingLabel={t('viewerLoadingPreview')}
          noPreviewLabel={t('viewerNoPreview')}
        />
      )}
      description={certificate.description}
      metaGroups={metaGroups}
      footerInfo={`${formatDateFull(certificate.created_at, locale)} · ${uploadedByText}`}
      closeLabel={t('viewerClose')}
      downloadLabel={t('download')}
      onDownload={handleDownload}
    />
  );
}

// ─── Org-level variant ──────────────────────────────────────────────

function useOrgCertificateViewUrl(certId: string | null) {
  return useAuthQuery({
    queryKey: ['org-certificates', certId ?? '', 'view-url'] as const,
    queryFn: (accessToken) => {
      if (certId === null) throw new Error('Missing certId');
      return getOrgCertificateViewUrl(accessToken, certId);
    },
    enabled: certId !== null,
    staleTime: 10 * 60 * 1000,
  });
}

export function OrgCertificateViewerDialog({
  certificate,
  open,
  onOpenChange,
}: OrgProps): JSX.Element {
  const t = useTranslations('viewerCertificates');
  const tType = useTranslations('orgCertificates.type');
  const tExpiry = useTranslations('orgCertificates.expiry');
  const locale = useLocale() as Locale;
  const { tokens } = useAuth();

  const viewUrlQuery = useOrgCertificateViewUrl(
    open && certificate !== null ? certificate.id : null,
  );
  const viewUrl = viewUrlQuery.data !== undefined ? viewUrlQuery.data.download_url : undefined;

  const handleDownload = useCallback(async () => {
    if (tokens === null || certificate === null) return;
    try {
      const { download_url: downloadUrl } = await getOrgCertificateDownloadUrl(
        tokens.access_token,
        certificate.id,
      );
      window.open(downloadUrl, '_blank');
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, certificate, t]);

  if (certificate === null) {
    return (
      <DocumentViewerDialog
        open={false}
        onOpenChange={onOpenChange}
        title=""
        subtitle=""
        preview={null}
        metaGroups={[]}
        footerInfo=""
        closeLabel={t('viewerClose')}
      />
    );
  }

  const expiry = getCertificateExpiryState(certificate.valid_until);

  const fileRows: MetaRow[] = [
    { label: t('fieldFilename'), value: certificate.original_filename, mono: true },
    { label: t('fieldSize'), value: formatSize(certificate.size_bytes), mono: true },
    { label: t('fieldFileType'), value: certificate.content_type, mono: true },
  ];

  const certRows: MetaRow[] = [
    { label: t('fieldType'), value: tType(certificate.certificate_type) },
  ];
  if (certificate.certificate_number !== null && certificate.certificate_number !== '') {
    certRows.push({ label: t('fieldNumber'), value: certificate.certificate_number, mono: true });
  }
  if (certificate.issuer !== null && certificate.issuer !== '') {
    certRows.push({ label: t('fieldIssuer'), value: certificate.issuer });
  }
  if (certificate.subject !== null && certificate.subject !== '') {
    certRows.push({ label: t('fieldSubject'), value: certificate.subject });
  }
  if (certificate.product_name !== null && certificate.product_name !== '') {
    certRows.push({ label: t('fieldProduct'), value: certificate.product_name });
  }
  if (certificate.supplier_name !== null && certificate.supplier_name !== '') {
    certRows.push({ label: t('fieldSupplier'), value: certificate.supplier_name });
  }
  if (certificate.valid_from !== null) {
    certRows.push({ label: t('fieldValidFrom'), value: formatDate(certificate.valid_from, locale), mono: true });
  }
  certRows.push({ label: t('fieldValidUntil'), value: formatDate(certificate.valid_until, locale), mono: true });
  certRows.push({
    label: t('fieldStatus'),
    value: (
      <Badge variant={EXPIRY_BADGE[expiry]} size="md" bordered>
        {tExpiry(expiry)}
      </Badge>
    ),
  });

  const originRows: MetaRow[] = [
    { label: t('fieldUploadedAt'), value: formatDateFull(certificate.created_at, locale), mono: true },
  ];
  if (certificate.uploaded_by_name !== null) {
    originRows.push({ label: t('fieldUploadedBy'), value: certificate.uploaded_by_name });
  }
  if (certificate.tags !== null && certificate.tags.length > 0) {
    originRows.push({
      label: t('fieldTags'),
      value: (
        <span className="flex flex-wrap justify-end gap-1">
          {certificate.tags.map((tag) => (
            <Badge key={tag} variant="default" size="md" bordered>{tag}</Badge>
          ))}
        </span>
      ),
    });
  }

  const uploadedByText = certificate.uploaded_by_name ?? '—';

  const metaGroups: MetaGroupSpec[] = [
    { title: t('groupFile'), rows: fileRows },
    { title: t('groupCertificate'), rows: certRows },
    { title: t('groupOrigin'), rows: originRows },
  ];

  return (
    <DocumentViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('viewerTitle')}
      subtitle={t('viewerSubtitle')}
      imageStage={isImage(certificate)}
      preview={(
        <CertificatePreview
          certificate={certificate}
          viewUrl={viewUrl}
          isLoading={viewUrlQuery.isLoading}
          loadingLabel={t('viewerLoadingPreview')}
          noPreviewLabel={t('viewerNoPreview')}
        />
      )}
      description={certificate.description}
      metaGroups={metaGroups}
      footerInfo={`${formatDateFull(certificate.created_at, locale)} · ${uploadedByText}`}
      closeLabel={t('viewerClose')}
      downloadLabel={t('download')}
      onDownload={handleDownload}
    />
  );
}
