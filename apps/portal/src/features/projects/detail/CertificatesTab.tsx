'use client';

import { Download, Eye, FileBadge, Search, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  EmptyState,
  MetaGrid,
  Select,
  Skeleton,
  type BadgeVariant,
} from '@bimstitch/ui';
import {
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            const isExpanded = expandedId === certificate.id;

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
            if (certificate.created_at !== undefined) {
              entries.push({ label: t('expandedAdded'), value: formatDate(certificate.created_at) });
            }

            return (
              <DetailCard
                key={certificate.id}
                expanded={isExpanded}
                onToggle={() => { setExpandedId(isExpanded ? null : certificate.id); }}
              >
                <DetailCardRow
                  media={
                    <FileBadge className="h-5 w-5 text-foreground-tertiary" aria-hidden />
                  }
                  actions={
                    <button
                      type="button"
                      title={t('download')}
                      onClick={(e) => { e.stopPropagation(); void handleDownload(certificate); }}
                      className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body3 font-semibold leading-tight text-foreground">
                      {certificate.original_filename}
                    </span>
                    <Badge variant="default" size="sm" bordered>
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
                </DetailCardBody>

                <DetailCardFooter className="justify-between">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { void handleDownload(certificate); }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('rowView')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { void handleDownload(certificate); }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('download')}
                    </Button>
                  </div>
                  {canUpload && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { handleDelete(certificate); }}
                      disabled={deleteMutation.isPending}
                      className="text-error hover:text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('expandedRemove')}
                    </Button>
                  )}
                </DetailCardFooter>
              </DetailCard>
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
