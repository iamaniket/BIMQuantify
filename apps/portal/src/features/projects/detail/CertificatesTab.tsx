'use client';

import { FileBadge, Library, Upload } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  EmptyState,
  Select,
  SplitButton,
} from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { CertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useDeleteCertificate } from '@/features/certificates/useDeleteCertificate';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { useProjectPermissions } from '@/features/permissions';

import { LinkFromLibraryDialog } from '@/features/orgCertificates/LinkFromLibraryDialog';

import { CertificateRow } from './CertificateRow';
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

export function CertificatesTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const { can } = useProjectPermissions(projectId);
  const [typeFilter, setTypeFilter] = useState<CertificateTypeValue | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewingCertificate, setViewingCertificate] = useState<Certificate | null>(null);
  const [supersedeCertificate, setSupersedeCertificate] = useState<Certificate | null>(null);

  const certificatesQuery = useCertificates(projectId, typeFilter);
  const deleteMutation = useDeleteCertificate(projectId);

  const canUpload = can('certificate', 'create');
  const canDelete = can('certificate', 'delete');

  const all = flattenPages(certificatesQuery.data);
  const certificates = searchQuery === ''
    ? all
    : all.filter((c) =>
        c.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
        || (c.issuer ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        || (c.certificate_number ?? '').toLowerCase().includes(searchQuery.toLowerCase()));

  const handleDelete = useCallback(
    (certificate: Certificate) => {
      deleteMutation.mutate(certificate.id, {
        onSuccess: () => { toast.success(t('deleteSuccess', { name: certificate.original_filename })); },
      });
    },
    [deleteMutation, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        filter={(
          <Select
            selectSize="md"
            value={typeFilter ?? 'all'}
            onChange={(e) => { setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as CertificateTypeValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            {TYPE_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={canUpload ? (
          <SplitButton
            label={t('uploadButton')}
            icon={<Upload className="h-3.5 w-3.5" />}
            onClick={() => { setUploadOpen(true); }}
            menuLabel={t('moreUploadOptions')}
            items={[
              {
                id: 'link-from-library',
                label: t('linkFromLibrary'),
                icon: <Library className="h-4 w-4" />,
                onSelect: () => { setLinkOpen(true); },
              },
            ]}
          />
        ) : undefined}
      />

      <div className="min-h-0 flex-1 overflow-auto">
      <ResourceList
        isLoading={certificatesQuery.isLoading}
        total={all.length}
        filteredCount={certificates.length}
        searchActive={searchQuery !== ''}
        noResultsLabel={t('noResults')}
        hasNextPage={certificatesQuery.hasNextPage}
        isFetchingNextPage={certificatesQuery.isFetchingNextPage}
        onLoadMore={() => { void certificatesQuery.fetchNextPage(); }}
        empty={(
          <EmptyState
            icon={FileBadge}
            title={t('title')}
            description={t('description')}
            action={canUpload ? (
              <Button variant="primary" size="md" onClick={() => { setUploadOpen(true); }}>
                {t('ctaLabel')}
              </Button>
            ) : undefined}
            className={undefined}
          />
        )}
      >
        {certificates.map((certificate) => (
          <CertificateRow
            key={certificate.id}
            projectId={projectId}
            certificate={certificate}
            expanded={expandedId === certificate.id}
            canUpload={canUpload}
            canDelete={canDelete}
            onToggle={() => { setExpandedId(expandedId === certificate.id ? null : certificate.id); }}
            onView={setViewingCertificate}
            onSupersede={setSupersedeCertificate}
            onDelete={handleDelete}
            deleteDisabled={deleteMutation.isPending}
          />
        ))}
      </ResourceList>
      </div>

      <CertificateUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />

      <LinkFromLibraryDialog
        projectId={projectId}
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />

      <CertificateViewerDialog
        certificate={viewingCertificate}
        projectId={projectId}
        open={viewingCertificate !== null}
        onOpenChange={(o) => { if (!o) setViewingCertificate(null); }}
      />

      {supersedeCertificate !== null && (
        <CertificateUploadDialog
          projectId={projectId}
          open
          onOpenChange={(o) => { if (!o) setSupersedeCertificate(null); }}
          supersedesId={supersedeCertificate.id}
          initialType={supersedeCertificate.certificate_type}
        />
      )}
    </div>
  );
}
