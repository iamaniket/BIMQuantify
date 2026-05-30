'use client';

import { Download, FileBadge, Search, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  EmptyState,
  Select,
  Skeleton,
  type BadgeVariant,
} from '@bimstitch/ui';

import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useDeleteCertificate } from '@/features/certificates/useDeleteCertificate';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useAuth } from '@/providers/AuthProvider';

import { CertificateUploadDialog } from './CertificateUploadDialog';

type Props = {
  projectId: string;
};

const TYPE_FILTERS: Array<{ value: CertificateTypeValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'product', labelKey: 'type.product' },
  { value: 'installation_test', labelKey: 'type.installation_test' },
  { value: 'inspection', labelKey: 'type.inspection' },
  { value: 'warranty', labelKey: 'type.warranty' },
  { value: 'other', labelKey: 'type.other' },
];

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

const WRITE_ROLES = new Set(['owner', 'editor', 'contractor']);

function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  return value.slice(0, 10);
}

export function CertificatesTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const { me, tokens } = useAuth();
  const [typeFilter, setTypeFilter] = useState<CertificateTypeValue | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const certificatesQuery = useCertificates(projectId, typeFilter);
  const deleteMutation = useDeleteCertificate(projectId);
  const membersQuery = useProjectMembers(projectId);

  const currentUserId = me === null ? null : me.user.id;
  const canUpload = (membersQuery.data ?? []).some(
    (m) => m.user_id === currentUserId && WRITE_ROLES.has(m.role),
  );

  const all = certificatesQuery.data ?? [];
  const certificates = searchQuery === ''
    ? all
    : all.filter((c) =>
        c.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
        || (c.issuer ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        || (c.certificate_number ?? '').toLowerCase().includes(searchQuery.toLowerCase()));

  const handleDownload = useCallback(
    async (certificate: Certificate) => {
      if (tokens === null) return;
      try {
        const resp = await getCertificateDownloadUrl(tokens.access_token, projectId, certificate.id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(t('downloadError'));
      }
    },
    [tokens, projectId, t],
  );

  const handleDelete = useCallback(
    (certificate: Certificate) => {
      deleteMutation.mutate(certificate.id, {
        onSuccess: () => { toast.success(t('deleteSuccess', { name: certificate.original_filename })); },
      });
    },
    [deleteMutation, t],
  );

  if (certificatesQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            placeholder={t('searchPlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-body3 text-foreground placeholder:text-foreground-disabled focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Select
          selectSize="sm"
          value={typeFilter ?? 'all'}
          onChange={(e) => { setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as CertificateTypeValue); }}
          className="w-auto shrink-0"
        >
          {TYPE_FILTERS.map(({ value, labelKey }) => (
            <option key={value} value={value}>{t(labelKey)}</option>
          ))}
        </Select>
        {canUpload && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setUploadOpen(true); }}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t('uploadButton')}
          </Button>
        )}
      </div>

      {certificates.length === 0 && (
        <EmptyState
          icon={FileBadge}
          title={t('title')}
          description={t('description')}
          action={canUpload ? (
            <Button variant="border" size="sm" onClick={() => { setUploadOpen(true); }}>
              {t('ctaLabel')}
            </Button>
          ) : undefined}
          className={undefined}
        />
      )}

      {certificates.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {certificates.map((certificate) => {
            const expiryState = getCertificateExpiryState(certificate.valid_until);
            return (
              <div
                key={certificate.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <FileBadge className="h-4 w-4 shrink-0 text-foreground-tertiary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body3 font-medium text-foreground">
                      {certificate.original_filename}
                    </span>
                    <Badge variant="default" size="sm" bordered>
                      {t(`type.${certificate.certificate_type}`)}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-caption text-foreground-tertiary">
                    {certificate.issuer !== null && certificate.issuer !== '' ? `${certificate.issuer} · ` : ''}
                    {certificate.certificate_number !== null && certificate.certificate_number !== ''
                      ? `${t('numberShort')} ${certificate.certificate_number} · `
                      : ''}
                    {t('validUntilShort', { date: formatDate(certificate.valid_until) })}
                  </div>
                </div>
                <Badge variant={EXPIRY_BADGE[expiryState]} size="sm" bordered>
                  {t(`expiry.${expiryState}`)}
                </Badge>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { void handleDownload(certificate); }}
                    aria-label={t('download')}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  {canUpload && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { handleDelete(certificate); }}
                      aria-label={t('delete')}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-error" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CertificateUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </div>
  );
}
