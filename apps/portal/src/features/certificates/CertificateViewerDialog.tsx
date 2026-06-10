'use client';

import { Download, FileBadge, Info, LinkIcon } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  type BadgeVariant,
} from '@bimstitch/ui';

import { Eyebrow } from '@/components/shared/Eyebrow';
import { formatDateFull, formatSize } from '@/features/attachments/attachmentMeta';
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

/** Date-only display (the value is an ISO date string like `2026-05-30`). */
function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  return value.slice(0, 10);
}

// ─── Media stage — mirrors the attachment viewer's preview chrome ─────

function NoPreview({ filename, label }: { filename: string; label: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <FileBadge className="h-12 w-12 text-foreground-tertiary" />
      <p className="text-body3 font-medium text-foreground">{filename}</p>
      <p className="text-caption text-foreground-tertiary">{label}</p>
    </div>
  );
}

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

// ─── Metadata rail ───────────────────────────────────────────────────

type MetaValue = { label: string; value: ReactNode; mono: boolean };

function MetaGroup({ title, rows }: { title: string; rows: MetaValue[] }): JSX.Element {
  return (
    <div>
      <Eyebrow className="mb-2.5">
        {title}
      </Eyebrow>
      <div className="flex flex-col">
        {rows.map(({ label, value, mono }) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-border py-[7px] last:border-b-0"
          >
            <span className="shrink-0 whitespace-nowrap text-[12.5px] text-foreground-tertiary">
              {label}
            </span>
            <span
              className={`min-w-0 max-w-[62%] break-words text-right text-[12.5px] font-medium tabular-nums text-foreground ${
                mono ? 'font-sans' : ''
              }`}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────

/**
 * Previews a certificate (PDF / image) in the same dialog shell as the
 * attachment viewer — media stage on the left, a grouped metadata rail on the
 * right — so the two surfaces read identically. The rail surfaces the
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
      <Dialog open={false}>
        <DialogContent />
      </Dialog>
    );
  }

  const expiry = getCertificateExpiryState(certificate.valid_until);
  const darkStage = isImage(certificate);

  // ── File ──
  const fileRows: MetaValue[] = [
    { label: t('fieldFilename'), value: certificate.original_filename, mono: true },
    { label: t('fieldSize'), value: formatSize(certificate.size_bytes), mono: true },
    { label: t('fieldFileType'), value: certificate.content_type, mono: true },
  ];

  // ── Certificate (the conformity metadata) ──
  const certRows: MetaValue[] = [
    { label: t('fieldType'), value: tType(certificate.certificate_type), mono: false },
  ];
  if (certificate.certificate_number !== null && certificate.certificate_number !== '') {
    certRows.push({ label: t('fieldNumber'), value: certificate.certificate_number, mono: true });
  }
  if (certificate.issuer !== null && certificate.issuer !== '') {
    certRows.push({ label: t('fieldIssuer'), value: certificate.issuer, mono: false });
  }
  if (certificate.subject !== null && certificate.subject !== '') {
    certRows.push({ label: t('fieldSubject'), value: certificate.subject, mono: false });
  }
  if (certificate.valid_from !== null) {
    certRows.push({ label: t('fieldValidFrom'), value: formatDate(certificate.valid_from), mono: true });
  }
  certRows.push({ label: t('fieldValidUntil'), value: formatDate(certificate.valid_until), mono: true });
  certRows.push({
    label: t('fieldStatus'),
    value: (
      <Badge variant={EXPIRY_BADGE[expiry]} size="md" bordered>
        {tExpiry(expiry)}
      </Badge>
    ),
    mono: false,
  });

  // ── Origin ──
  const originRows: MetaValue[] = [
    { label: t('fieldUploadedAt'), value: formatDateFull(certificate.created_at), mono: true },
  ];
  if (certificate.uploaded_by_name !== null) {
    originRows.push({ label: t('fieldUploadedBy'), value: certificate.uploaded_by_name, mono: false });
  }
  const uploadedByText = certificate.uploaded_by_name ?? '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[620px] max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] flex-col overflow-hidden p-0"
        style={{ maxWidth: 'calc(100vw - 48px)' }}
      >
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
          <DialogTitle>{t('viewerTitle')}</DialogTitle>
          <DialogDescription>{t('viewerSubtitle')}</DialogDescription>
        </DialogHeader>

        {/* Body — media stage + metadata rail */}
        <DialogBody className="grid min-h-0 flex-1 grid-cols-[1fr_296px] gap-0 overflow-hidden p-0">
          <div className="min-h-0 p-5">
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg ${
                darkStage ? 'bg-[#101316]' : 'bg-background-secondary'
              }`}
            >
              <CertificatePreview
                certificate={certificate}
                viewUrl={viewUrl}
                isLoading={viewUrlQuery.isLoading}
                loadingLabel={t('viewerLoadingPreview')}
                noPreviewLabel={t('viewerNoPreview')}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface-low px-5 py-5">
            {certificate.description !== null && certificate.description !== '' && (
              <div className="text-body3 leading-snug text-foreground-secondary">
                {certificate.description}
              </div>
            )}
            <MetaGroup title={t('groupFile')} rows={fileRows} />
            <MetaGroup title={t('groupCertificate')} rows={certRows} />
            <MetaGroup title={t('groupOrigin')} rows={originRows} />
          </div>
        </DialogBody>

        {/* Footer — info · Close · Download */}
        <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2 text-foreground-tertiary">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-sans text-[11.5px]">
              {`${formatDateFull(certificate.created_at)} · ${uploadedByText}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="border"
              size="md"
              onClick={() => { onOpenChange(false); }}
            >
              {t('viewerClose')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleDownload}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t('download')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <Dialog open={false}>
        <DialogContent />
      </Dialog>
    );
  }

  const expiry = getCertificateExpiryState(certificate.valid_until);
  const darkStage = isImage(certificate);

  const fileRows: MetaValue[] = [
    { label: t('fieldFilename'), value: certificate.original_filename, mono: true },
    { label: t('fieldSize'), value: formatSize(certificate.size_bytes), mono: true },
    { label: t('fieldFileType'), value: certificate.content_type, mono: true },
  ];

  const certRows: MetaValue[] = [
    { label: t('fieldType'), value: tType(certificate.certificate_type), mono: false },
  ];
  if (certificate.certificate_number !== null && certificate.certificate_number !== '') {
    certRows.push({ label: t('fieldNumber'), value: certificate.certificate_number, mono: true });
  }
  if (certificate.issuer !== null && certificate.issuer !== '') {
    certRows.push({ label: t('fieldIssuer'), value: certificate.issuer, mono: false });
  }
  if (certificate.subject !== null && certificate.subject !== '') {
    certRows.push({ label: t('fieldSubject'), value: certificate.subject, mono: false });
  }
  if (certificate.product_name !== null && certificate.product_name !== '') {
    certRows.push({ label: t('fieldProduct'), value: certificate.product_name, mono: false });
  }
  if (certificate.supplier_name !== null && certificate.supplier_name !== '') {
    certRows.push({ label: t('fieldSupplier'), value: certificate.supplier_name, mono: false });
  }
  if (certificate.valid_from !== null) {
    certRows.push({ label: t('fieldValidFrom'), value: formatDate(certificate.valid_from), mono: true });
  }
  certRows.push({ label: t('fieldValidUntil'), value: formatDate(certificate.valid_until), mono: true });
  certRows.push({
    label: t('fieldStatus'),
    value: (
      <Badge variant={EXPIRY_BADGE[expiry]} size="md" bordered>
        {tExpiry(expiry)}
      </Badge>
    ),
    mono: false,
  });

  const originRows: MetaValue[] = [
    { label: t('fieldUploadedAt'), value: formatDateFull(certificate.created_at), mono: true },
  ];
  if (certificate.uploaded_by_name !== null) {
    originRows.push({ label: t('fieldUploadedBy'), value: certificate.uploaded_by_name, mono: false });
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
      mono: false,
    });
  }

  const uploadedByText = certificate.uploaded_by_name ?? '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[620px] max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] flex-col overflow-hidden p-0"
        style={{ maxWidth: 'calc(100vw - 48px)' }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
          <DialogTitle>{t('viewerTitle')}</DialogTitle>
          <DialogDescription>{t('viewerSubtitle')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="grid min-h-0 flex-1 grid-cols-[1fr_296px] gap-0 overflow-hidden p-0">
          <div className="min-h-0 p-5">
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg ${
                darkStage ? 'bg-[#101316]' : 'bg-background-secondary'
              }`}
            >
              <CertificatePreview
                certificate={certificate}
                viewUrl={viewUrl}
                isLoading={viewUrlQuery.isLoading}
                loadingLabel={t('viewerLoadingPreview')}
                noPreviewLabel={t('viewerNoPreview')}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface-low px-5 py-5">
            {certificate.description !== null && certificate.description !== '' && (
              <div className="text-body3 leading-snug text-foreground-secondary">
                {certificate.description}
              </div>
            )}
            <MetaGroup title={t('groupFile')} rows={fileRows} />
            <MetaGroup title={t('groupCertificate')} rows={certRows} />
            <MetaGroup title={t('groupOrigin')} rows={originRows} />
          </div>
        </DialogBody>

        <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2 text-foreground-tertiary">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-sans text-[11.5px]">
              {`${formatDateFull(certificate.created_at)} · ${uploadedByText}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="border" size="md" onClick={() => { onOpenChange(false); }}>
              {t('viewerClose')}
            </Button>
            <Button type="button" variant="primary" size="md" onClick={handleDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t('download')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
