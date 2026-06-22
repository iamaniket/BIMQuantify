'use client';

import { LayoutGrid, Library, Table2, Upload } from '@bimstitch/ui/icons';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Select, Skeleton, SplitButton, TabsContent } from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { useProjectPermissions } from '@/features/permissions';
import { CertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import { ProjectCertificatesHero } from '@/features/certificates/ProjectCertificatesHero';
import { ProjectCertificatesOverview } from '@/features/certificates/ProjectCertificatesOverview';
import { ProjectCertificatesTable } from '@/features/certificates/ProjectCertificatesTable';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useDeleteCertificate } from '@/features/certificates/useDeleteCertificate';
import { LinkFromLibraryDialog } from '@/features/orgCertificates/LinkFromLibraryDialog';
import { CertificateUploadDialog } from '@/features/projects/detail/CertificateUploadDialog';
import { useProject } from '@/features/projects/useProject';
import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import { ApiError } from '@/lib/api/client';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { useAllInfinitePages } from '@/lib/query/useAllInfinitePages';
import { useClientPagination } from '@/lib/query/useTableQuery';
import { useAuth } from '@/providers/AuthProvider';

const TYPE_FILTERS: Array<{ value: CertificateTypeValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'all' },
  { value: 'product', labelKey: 'product' },
  { value: 'installation_test', labelKey: 'installation_test' },
  { value: 'inspection', labelKey: 'inspection' },
  { value: 'warranty', labelKey: 'warranty' },
  { value: 'other', labelKey: 'other' },
];

/**
 * Dedicated per-project Certificates page — the shared "hero + tabbed" pattern
 * (Findings / Reports). Overview tab (totals, by-type, expiry breakdown) plus a
 * sortable / paginated / searchable Certificates list. The full certificate set
 * is drained from the infinite query and paged client-side (low per-project
 * volume; no server sort on this route).
 */
export default function ProjectCertificatesPage(): JSX.Element {
  const t = useTranslations('certificates.hub');
  const tType = useTranslations('projectDetail.tabs.certificates.type');
  const tCert = useTranslations('projectDetail.tabs.certificates');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const { tokens } = useAuth();

  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CertificateTypeValue | undefined>(undefined);
  const [viewing, setViewing] = useState<Certificate | null>(null);
  const [supersede, setSupersede] = useState<Certificate | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const projectQuery = useProject(projectId);
  const certificatesQuery = useCertificates(projectId);
  const certificates = useAllInfinitePages(certificatesQuery);
  const deleteMutation = useDeleteCertificate(projectId);
  const { can } = useProjectPermissions(projectId);
  const canUpload = can('certificate', 'create');
  const canDelete = can('certificate', 'delete');

  const projectName = projectQuery.data?.name;
  const crumbs = useMemo(
    () => (projectName === undefined
      ? null
      : [
        { label: t('crumbProjects'), href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return certificates.items.filter((c) => {
      if (typeFilter !== undefined && c.certificate_type !== typeFilter) return false;
      if (query !== '') {
        return (
          c.original_filename.toLowerCase().includes(query)
          || (c.issuer ?? '').toLowerCase().includes(query)
          || (c.certificate_number ?? '').toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [certificates.items, search, typeFilter]);

  const table = useClientPagination<Certificate>(filtered, {
    sortAccessors: {
      filename: (c) => c.original_filename,
      type: (c) => c.certificate_type,
      issuer: (c) => c.issuer ?? '',
      valid_until: (c) => c.valid_until,
      created_at: (c) => c.created_at,
    },
    initialSort: { key: 'valid_until', dir: 'asc' },
    isLoading: certificates.isLoading,
    isError: certificates.isError,
  });

  const handleDownload = useCallback(
    async (cert: Certificate) => {
      if (tokens === null) return;
      try {
        const resp = await getCertificateDownloadUrl(tokens.access_token, projectId, cert.id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(tCert('downloadError'));
      }
    },
    [tokens, projectId, tCert],
  );

  const handleDelete = useCallback(
    (cert: Certificate) => {
      deleteMutation.mutate(cert.id, {
        onSuccess: () => { toast.success(tCert('deleteSuccess', { name: cert.original_filename })); },
      });
    },
    [deleteMutation, tCert],
  );

  if (projectQuery.isLoading) {
    return (
      <PageShell
        hero={(
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[140px] w-[200px] rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        )}
      >
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-6">
        <ErrorBanner
          message={isNotFound ? t('projectNotFound') : t('projectLoadError')}
          tone="soft"
          className="text-body2"
        />
      </main>
    );
  }

  const project = projectQuery.data;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    list: { eyebrow: t('panel.listEyebrow'), title: t('panel.listTitle', { count: table.total }) },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<ProjectCertificatesHero projectName={project.name} certificates={certificates.items} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'list',
          label: t('tabs.list'),
          icon: <Table2 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{table.total}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'list'}
      toolbar={tab === 'list' ? (
        <TableToolbar
          actions={canUpload ? (
            <SplitButton
              label={tCert('uploadButton')}
              icon={<Upload className="h-3.5 w-3.5" />}
              onClick={() => { setUploadOpen(true); }}
              menuLabel={tCert('moreUploadOptions')}
              items={[
                {
                  id: 'link-from-library',
                  label: tCert('linkFromLibrary'),
                  icon: <Library className="h-4 w-4" />,
                  onSelect: () => { setLinkOpen(true); },
                },
              ]}
            />
          ) : undefined}
        >
          <SearchInput
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onChange={setSearch}
            aria-label={t('list.searchPlaceholder')}
          />
          <Select
            selectSize="md"
            className="w-auto shrink-0"
            value={typeFilter ?? 'all'}
            onChange={(e) => { setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as CertificateTypeValue); }}
          >
            {TYPE_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {value === 'all' ? t('list.filterAll') : tType(labelKey)}
              </option>
            ))}
          </Select>
        </TableToolbar>
      ) : undefined}
      afterTabs={(
        <>
          <CertificateUploadDialog projectId={projectId} open={uploadOpen} onOpenChange={setUploadOpen} />
          <LinkFromLibraryDialog projectId={projectId} open={linkOpen} onOpenChange={setLinkOpen} />
          <CertificateViewerDialog
            certificate={viewing}
            projectId={projectId}
            open={viewing !== null}
            onOpenChange={(o) => { if (!o) setViewing(null); }}
          />
          {supersede !== null && (
            <CertificateUploadDialog
              projectId={projectId}
              open
              onOpenChange={(o) => { if (!o) setSupersede(null); }}
              supersedesId={supersede.id}
              initialType={supersede.certificate_type}
            />
          )}
        </>
      )}
    >
      <TabsContent value="overview" className="mt-0">
        {certificates.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ProjectCertificatesOverview certificates={certificates.items} />
        )}
      </TabsContent>

      <TabsContent value="list" className="mt-0 flex min-h-0 flex-1 flex-col">
        <ProjectCertificatesTable
          table={table}
          canUpload={canUpload}
          canDelete={canDelete}
          onView={setViewing}
          onDownload={(cert) => { void handleDownload(cert); }}
          onSupersede={setSupersede}
          onDelete={handleDelete}
        />
        <TablePaginationFooter
          table={table}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
