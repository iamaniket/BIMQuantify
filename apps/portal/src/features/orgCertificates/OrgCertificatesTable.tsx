'use client';

import { Download, Eye, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, type BadgeVariant } from '@bimstitch/ui';

import { PageTable, type Column } from '@/components/shared/PageTable';
import type { OrgCertificate } from '@/lib/api/schemas';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';

type Props = {
  certificates: OrgCertificate[];
  onDownload: (cert: OrgCertificate) => void;
  onDelete: (cert: OrgCertificate) => void;
  onView: (cert: OrgCertificate) => void;
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  return new Date(value).toLocaleDateString();
}

export function OrgCertificatesTable({ certificates, onDownload, onDelete, onView }: Props): JSX.Element {
  const t = useTranslations('orgCertificates');

  const columns: Column<OrgCertificate>[] = [
    {
      header: t('table.product'),
      cell: (cert) => (
        <>
          <span className="font-medium text-foreground">
            {cert.product_name !== null && cert.product_name !== ''
              ? cert.product_name
              : cert.original_filename}
          </span>
          {cert.product_name !== null && cert.product_name !== '' && (
            <div className="font-sans text-caption text-foreground-tertiary">
              {cert.original_filename}
            </div>
          )}
        </>
      ),
    },
    {
      header: t('table.type'),
      cell: (cert) => (
        <Badge variant="default" size="sm" bordered>
          {t(`type.${cert.certificate_type}`)}
        </Badge>
      ),
    },
    {
      header: t('table.supplier'),
      className: 'text-foreground-secondary',
      cell: (cert) => cert.supplier_name ?? '—',
    },
    {
      header: t('table.issuer'),
      className: 'text-foreground-secondary',
      cell: (cert) => cert.issuer ?? '—',
    },
    {
      header: t('table.validUntil'),
      cell: (cert) => {
        const expiryState = getCertificateExpiryState(cert.valid_until);
        return (
          <>
            <Badge variant={EXPIRY_BADGE[expiryState]} size="sm" bordered>
              {t(`expiry.${expiryState}`)}
            </Badge>
            {cert.valid_until !== null && (
              <div className="mt-0.5 font-sans text-caption text-foreground-tertiary tabular-nums">
                {formatDate(cert.valid_until)}
              </div>
            )}
          </>
        );
      },
    },
    {
      header: t('table.tags'),
      cell: (cert) =>
        cert.tags !== null && cert.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {cert.tags.map((tag) => (
              <Badge key={tag} variant="default" size="sm" bordered>
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-foreground-tertiary">—</span>
        ),
    },
    {
      header: '',
      cell: (cert) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            title={t('list.view')}
            onClick={() => { onView(cert); }}
            className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('list.download')}
            onClick={() => { onDownload(cert); }}
            className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('list.remove')}
            onClick={() => { onDelete(cert); }}
            className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-error"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={certificates}
      rowKey={(c) => c.id}
      emptyMessage={t('list.emptyTitle')}
    />
  );
}
