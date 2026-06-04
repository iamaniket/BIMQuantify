'use client';

import { FileBadge, Link2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@bimstitch/ui';

import type { OrgCertificate } from '@/lib/api/schemas';
import { getCertificateExpiryState, type CertificateExpiryState } from '@/features/certificates/expiry';
import type { BadgeVariant } from '@bimstitch/ui';

import { useOrgCertificates } from './useOrgCertificates';
import { useLinkFromLibrary } from './useLinkFromLibrary';

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

export function LinkFromLibraryDialog({ projectId, open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('orgCertificates.linkDialog');
  const tType = useTranslations('orgCertificates.type');
  const tExpiry = useTranslations('orgCertificates.expiry');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const certsQuery = useOrgCertificates(undefined, search);
  const linkMutation = useLinkFromLibrary(projectId);

  const certificates = certsQuery.data ?? [];

  const handleLink = () => {
    if (selectedId === null) return;
    linkMutation.mutate(selectedId, {
      onSuccess: () => {
        toast.success(t('success'));
        setSelectedId(null);
        setSearch('');
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              placeholder={t('searchPlaceholder')}
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-body3 text-foreground placeholder:text-foreground-disabled focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {certsQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!certsQuery.isLoading && certificates.length === 0 && (
            <p className="py-6 text-center text-body3 text-foreground-tertiary">
              {t('empty')}
            </p>
          )}

          {certificates.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              {certificates.map((cert: OrgCertificate) => {
                const expiryState = getCertificateExpiryState(cert.valid_until);
                const isSelected = selectedId === cert.id;
                return (
                  <button
                    key={cert.id}
                    type="button"
                    onClick={() => { setSelectedId(isSelected ? null : cert.id); }}
                    className={`flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-background-hover'
                    }`}
                  >
                    <FileBadge className="h-4 w-4 shrink-0 text-foreground-tertiary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-body3 font-medium text-foreground">
                          {cert.product_name ?? cert.original_filename}
                        </span>
                        <Badge variant="default" size="sm" bordered>
                          {tType(cert.certificate_type)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-foreground-tertiary">
                        {cert.supplier_name !== null && cert.supplier_name !== '' && (
                          <>
                            <span>{cert.supplier_name}</span>
                            <span>·</span>
                          </>
                        )}
                        <span>{formatDate(cert.valid_until)}</span>
                        <span>·</span>
                        <Badge variant={EXPIRY_BADGE[expiryState]} size="sm" bordered>
                          {tExpiry(expiryState)}
                        </Badge>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="h-4 w-4 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">{t('cancel')}</Button>
            </DialogClose>
            <Button
              variant="primary"
              size="sm"
              onClick={handleLink}
              disabled={selectedId === null || linkMutation.isPending}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
              {t('linkButton')}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
