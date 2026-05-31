'use client';

import { FileBadge, Loader2, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { Badge, Button, Input, type BadgeVariant } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { useElementCertificates } from '@/features/certificates/useElementCertificates';
import { useProjectCertificates } from '@/features/certificates/useCertificates';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { CertificateUploadDialog } from '@/features/projects/detail/CertificateUploadDialog';

type EntityCertificatesBodyProps = {
  projectId: string;
  /** Version-independent identity anchor — certificates query/create by this. */
  modelId: string;
  /** The open file version — recorded as "raised on this version" provenance. */
  fileId: string;
  globalId: string | null;
  autoOpenNonce?: number | undefined;
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

export function EntityCertificatesBody({
  projectId,
  modelId,
  fileId,
  globalId,
  autoOpenNonce,
}: EntityCertificatesBodyProps): JSX.Element {
  const t = useTranslations('viewerCertificates');
  const tTypes = useTranslations('projectDetail.tabs.certificates.type');
  const tExpiry = useTranslations('projectDetail.tabs.certificates.expiry');

  const isProject = globalId === null;
  const elementQuery = useElementCertificates(projectId, modelId, globalId);
  const projectQuery = useProjectCertificates(projectId, isProject);
  const query = isProject ? projectQuery : elementQuery;
  const [uploadOpen, setUploadOpen] = useState(false);
  const lastConsumedNonce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (autoOpenNonce !== undefined && autoOpenNonce !== lastConsumedNonce.current) {
      lastConsumedNonce.current = autoOpenNonce;
      setUploadOpen(true);
    }
  }, [autoOpenNonce]);

  const certificates = query.data ?? [];

  const [search, setSearch] = useState('');
  const filteredCertificates = useMemo(() => {
    if (search.trim() === '') return certificates;
    const q = search.toLowerCase();
    return certificates.filter((c) => {
      if (c.original_filename.toLowerCase().includes(q)) return true;
      if (c.issuer !== null && c.issuer.toLowerCase().includes(q)) return true;
      return c.certificate_number !== null && c.certificate_number.toLowerCase().includes(q);
    });
  }, [certificates, search]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={t('filterPlaceholder')}
            inputSize="sm"
            className="pl-7"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => { setUploadOpen(true); }}
          title={t('uploadButton')}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('uploadButton')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {query.isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredCertificates.length === 0 ? (
          <PanelEmptyState
            icon={FileBadge}
            message={isProject ? t('emptyProjectEmpty') : t('emptyNoItems')}
          />
        ) : (
          <div className="flex flex-col">
            {filteredCertificates.map((cert) => {
              const expiry = getCertificateExpiryState(cert.valid_until);
              return (
                <div
                  key={cert.id}
                  className="flex w-full items-center gap-2 border-b border-border px-2.5 py-2 text-left transition-colors hover:bg-background-hover"
                >
                  <Badge variant="default" className="w-fit shrink-0">
                    {tTypes(cert.certificate_type)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">
                    {cert.original_filename}
                  </span>
                  <Badge variant={EXPIRY_BADGE[expiry]} className="w-fit shrink-0">
                    {tExpiry(expiry)}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CertificateUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        linkedElementGlobalId={globalId}
        linkedModelId={globalId !== null ? modelId : null}
        linkedFileId={globalId !== null ? fileId : null}
      />
    </div>
  );
}

export function useEntityCertificateCount(
  projectId: string,
  modelId: string,
  globalId: string | null,
): number {
  const query = useElementCertificates(projectId, modelId, globalId);
  return query.data?.length ?? 0;
}
