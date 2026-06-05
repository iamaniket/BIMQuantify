'use client';

import { Download, Eye, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeVariant,
} from '@bimstitch/ui';

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

  if (certificates.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {t('list.emptyTitle')}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('table.product')}</TableHead>
          <TableHead>{t('table.type')}</TableHead>
          <TableHead>{t('table.supplier')}</TableHead>
          <TableHead>{t('table.issuer')}</TableHead>
          <TableHead>{t('table.validUntil')}</TableHead>
          <TableHead>{t('table.tags')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {certificates.map((cert) => {
          const expiryState = getCertificateExpiryState(cert.valid_until);
          return (
            <TableRow key={cert.id} className="hover:bg-background-hover">
              <TableCell>
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
              </TableCell>
              <TableCell>
                <Badge variant="default" size="sm" bordered>
                  {t(`type.${cert.certificate_type}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-foreground-secondary">
                {cert.supplier_name ?? '—'}
              </TableCell>
              <TableCell className="text-foreground-secondary">
                {cert.issuer ?? '—'}
              </TableCell>
              <TableCell>
                <Badge variant={EXPIRY_BADGE[expiryState]} size="sm" bordered>
                  {t(`expiry.${expiryState}`)}
                </Badge>
                {cert.valid_until !== null && (
                  <div className="mt-0.5 font-sans text-caption text-foreground-tertiary tabular-nums">
                    {formatDate(cert.valid_until)}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {cert.tags !== null && cert.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {cert.tags.map((tag) => (
                      <Badge key={tag} variant="default" size="sm" bordered>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-foreground-tertiary">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    title={t('list.view')}
                    onClick={() => { onView(cert); }}
                    className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('list.download')}
                    onClick={() => { onDownload(cert); }}
                    className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('list.remove')}
                    onClick={() => { onDelete(cert); }}
                    className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
