'use client';

import { Box, ClipboardCheck, Download, Eye, FileBadge, Glasses, ShieldCheck, Trash2, Upload } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentType, JSX } from 'react';

import { Badge, type BadgeVariant } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';

import { getCertificateExpiryState, type CertificateExpiryState } from './expiry';

type Props = {
  table: TablePagination<Certificate>;
  canUpload: boolean;
  canDelete: boolean;
  onView: (cert: Certificate) => void;
  onDownload: (cert: Certificate) => void;
  onSupersede: (cert: Certificate) => void;
  onDelete: (cert: Certificate) => void;
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

const TYPE_ICON: Record<CertificateTypeValue, ComponentType<{ className?: string }>> = {
  product: Box,
  installation_test: ClipboardCheck,
  inspection: Glasses,
  warranty: ShieldCheck,
  other: FileBadge,
};

const actionBtn = 'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground';

export function ProjectCertificatesTable({
  table,
  canUpload,
  canDelete,
  onView,
  onDownload,
  onSupersede,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('certificates.hub');
  const tType = useTranslations('projectDetail.tabs.certificates.type');
  const tExpiry = useTranslations('projectDetail.tabs.certificates.expiry');
  const locale = useLocale() as Locale;

  const columns: Column<Certificate>[] = [
    {
      header: t('columns.certificate'),
      sortKey: 'filename',
      cell: (cert) => {
        const Icon = TYPE_ICON[cert.certificate_type];
        return (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-high text-foreground-secondary">
              <Icon className="h-4 w-4" />
            </div>
            <span className="min-w-0 truncate font-medium text-foreground">{cert.original_filename}</span>
          </div>
        );
      },
    },
    {
      header: t('columns.type'),
      sortKey: 'type',
      cell: (cert) => (
        <Badge variant="default" size="md" bordered>
          {tType(cert.certificate_type)}
        </Badge>
      ),
    },
    {
      header: t('columns.issuer'),
      sortKey: 'issuer',
      className: 'text-foreground-secondary',
      cell: (cert) => cert.issuer ?? '—',
    },
    {
      header: t('columns.number'),
      className: 'text-foreground-secondary tabular-nums',
      cell: (cert) => cert.certificate_number ?? '—',
    },
    {
      header: t('columns.validUntil'),
      sortKey: 'valid_until',
      cell: (cert) => {
        const expiryState = getCertificateExpiryState(cert.valid_until);
        return (
          <>
            <Badge variant={EXPIRY_BADGE[expiryState]} size="md" bordered>
              {tExpiry(expiryState)}
            </Badge>
            {cert.valid_until !== null && (
              <div className="mt-0.5 font-sans text-caption text-foreground-tertiary tabular-nums">
                {formatDate(cert.valid_until, locale)}
              </div>
            )}
          </>
        );
      },
    },
    {
      header: t('columns.added'),
      sortKey: 'created_at',
      className: 'text-foreground-tertiary tabular-nums',
      cell: (cert) => formatDate(cert.created_at, locale),
    },
    {
      header: '',
      headerClassName: 'text-right',
      cell: (cert) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" title={t('columns.view')} onClick={() => { onView(cert); }} className={actionBtn}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" title={t('columns.download')} onClick={() => { onDownload(cert); }} className={actionBtn}>
            <Download className="h-4 w-4" />
          </button>
          {canUpload && (
            <button type="button" title={t('columns.newVersion')} onClick={() => { onSupersede(cert); }} className={actionBtn}>
              <Upload className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              title={t('columns.delete')}
              onClick={() => { onDelete(cert); }}
              className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(c) => c.id}
      emptyMessage={t('list.empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={t('list.loadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
