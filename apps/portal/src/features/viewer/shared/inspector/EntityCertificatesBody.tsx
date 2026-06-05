'use client';

import { Eye, FileBadge, Loader2, Plus, Search, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
  Input,
  MetaGrid,
  type BadgeVariant,
} from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { CertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import { useDeleteCertificate } from '@/features/certificates/useDeleteCertificate';
import { useElementCertificates } from '@/features/certificates/useElementCertificates';
import { useFileCertificates, useProjectCertificates } from '@/features/certificates/useCertificates';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { CertificateUploadDialog } from '@/features/projects/detail/CertificateUploadDialog';
import type { Certificate } from '@/lib/api/schemas';

/**
 * How the certificates shown here are scoped — mirrors FindingsScope: by IFC
 * element (3D), by the whole project (unlinked), or by the open file (PDF).
 */
export type CertificatesScope =
  | { kind: 'element'; modelId: string; fileId: string; globalId: string }
  | { kind: 'project' }
  | { kind: 'file'; fileId: string };

type EntityCertificatesBodyProps = {
  projectId: string;
  scope: CertificatesScope;
  autoOpenNonce?: number | undefined;
  /** Called once the nonce has been consumed so the parent can clear it. */
  onAutoOpenConsumed?: () => void;
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function EntityCertificatesBody({
  projectId,
  scope,
  autoOpenNonce,
  onAutoOpenConsumed,
}: EntityCertificatesBodyProps): JSX.Element {
  const t = useTranslations('viewerCertificates');
  const tTypes = useTranslations('projectDetail.tabs.certificates.type');
  const tExpiry = useTranslations('projectDetail.tabs.certificates.expiry');

  // Resolve the active query unconditionally (Hooks rules) — inapplicable
  // queries are disabled via their `enabled`/null args.
  const elementScope = scope.kind === 'element' ? scope : null;
  const fileScope = scope.kind === 'file' ? scope : null;
  const elementQuery = useElementCertificates(
    projectId,
    elementScope?.modelId ?? '',
    elementScope?.globalId ?? null,
  );
  const projectQuery = useProjectCertificates(projectId, scope.kind === 'project');
  const fileQuery = useFileCertificates(projectId, fileScope?.fileId ?? null);
  const query =
    scope.kind === 'project' ? projectQuery
    : scope.kind === 'file' ? fileQuery
    : elementQuery;
  const deleteMutation = useDeleteCertificate(projectId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewingCertificate, setViewingCertificate] = useState<Certificate | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lastConsumedNonce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (autoOpenNonce !== undefined && autoOpenNonce !== lastConsumedNonce.current) {
      lastConsumedNonce.current = autoOpenNonce;
      setUploadOpen(true);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenNonce, onAutoOpenConsumed]);

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

  const handleDelete = useCallback(
    (cert: Certificate) => {
      deleteMutation.mutate(cert.id, {
        onSuccess: () => {
          if (expandedId === cert.id) setExpandedId(null);
          toast.success(t('deleteSuccess'));
        },
      });
    },
    [deleteMutation, expandedId, t],
  );

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
            message={
              scope.kind === 'project'
                ? t('emptyProjectEmpty')
                : scope.kind === 'file'
                  ? t('emptyFileEmpty')
                  : t('emptyNoItems')
            }
          />
        ) : (
          <div className="flex flex-col">
            {filteredCertificates.map((cert) => {
              const expiry = getCertificateExpiryState(cert.valid_until);
              const isExpanded = expandedId === cert.id;

              const entries: Array<{ label: string; value: string }> = [
                { label: t('fieldType'), value: tTypes(cert.certificate_type) },
              ];
              if (cert.issuer !== null && cert.issuer !== '') {
                entries.push({ label: t('fieldIssuer'), value: cert.issuer });
              }
              if (cert.certificate_number !== null && cert.certificate_number !== '') {
                entries.push({ label: t('fieldNumber'), value: cert.certificate_number });
              }
              if (cert.valid_from !== null) {
                entries.push({ label: t('fieldValidFrom'), value: formatDate(cert.valid_from) });
              }
              if (cert.valid_until !== null) {
                entries.push({ label: t('fieldValidUntil'), value: formatDate(cert.valid_until) });
              }
              entries.push({ label: t('fieldUploadedAt'), value: formatDate(cert.created_at) });

              return (
                <DetailCard
                  key={cert.id}
                  expanded={isExpanded}
                  onToggle={() => { setExpandedId(isExpanded ? null : cert.id); }}
                >
                  <DetailCardRow
                    media={
                      <FileBadge className="h-5 w-5 text-foreground-tertiary" aria-hidden />
                    }
                    actions={
                      <button
                        type="button"
                        title={t('rowView')}
                        onClick={(e) => { e.stopPropagation(); setViewingCertificate(cert); }}
                        className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body3 font-semibold leading-tight text-foreground">
                        {cert.original_filename}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
                      <Badge variant="default" size="sm" className="w-fit shrink-0">
                        {tTypes(cert.certificate_type)}
                      </Badge>
                      <span className="shrink-0">·</span>
                      <Badge variant={EXPIRY_BADGE[expiry]} size="sm" className="w-fit shrink-0">
                        {tExpiry(expiry)}
                      </Badge>
                    </div>
                  </DetailCardRow>

                  <DetailCardBody>
                    <MetaGrid entries={entries} />
                  </DetailCardBody>

                  <DetailCardFooter className="justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setViewingCertificate(cert); }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('rowView')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { handleDelete(cert); }}
                      disabled={deleteMutation.isPending}
                      className="text-error hover:text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('expandedRemove')}
                    </Button>
                  </DetailCardFooter>
                </DetailCard>
              );
            })}
          </div>
        )}
      </div>

      <CertificateUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        linkedElementGlobalId={scope.kind === 'element' ? scope.globalId : null}
        linkedModelId={scope.kind === 'element' ? scope.modelId : null}
        linkedFileId={scope.kind === 'project' ? null : scope.fileId}
      />

      <CertificateViewerDialog
        certificate={viewingCertificate}
        projectId={projectId}
        open={viewingCertificate !== null}
        onOpenChange={(o) => { if (!o) setViewingCertificate(null); }}
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
