'use client';

import { LayoutGrid, Plus, Table2 } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Select,
  Skeleton,
  TabsContent,
} from '@bimdossier/ui';

import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';

import {
  getOrgCertificateDownloadUrl,
  listOrgCertificatesPage,
} from '@/lib/api/orgCertificates';
import type { CertificateTypeValue, OrgCertificate } from '@/lib/api/schemas';
import { useTableQuery } from '@/lib/query/useTableQuery';
import { OrgCertificatesHero } from '@/features/orgCertificates/OrgCertificatesHero';
import { OrgCertificatesTable } from '@/features/orgCertificates/OrgCertificatesTable';
import { OrgCertificatesOverview } from '@/features/orgCertificates/OrgCertificatesOverview';
import { OrgCertificateUploadDialog } from '@/features/orgCertificates/OrgCertificateUploadDialog';
import { OrgCertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import { useOrgCertificates } from '@/features/orgCertificates/useOrgCertificates';
import { useDeleteOrgCertificate } from '@/features/orgCertificates/useDeleteOrgCertificate';
import { useAuth } from '@/providers/AuthProvider';

const TYPE_OPTIONS: Array<{ value: CertificateTypeValue | 'all'; key: string }> = [
  { value: 'all', key: 'filterAll' },
  { value: 'product', key: 'type.product' },
  { value: 'installation_test', key: 'type.installation_test' },
  { value: 'inspection', key: 'type.inspection' },
  { value: 'warranty', key: 'type.warranty' },
  { value: 'other', key: 'type.other' },
];

export default function CertificatesPage(): JSX.Element {
  const t = useTranslations('orgCertificates');
  const { tokens } = useAuth();

  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CertificateTypeValue | undefined>(undefined);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewingCert, setViewingCert] = useState<OrgCertificate | null>(null);

  // Overview reads the org-wide (unfiltered) library for its aggregates.
  const certsQuery = useOrgCertificates();
  const allCerts = certsQuery.data ?? [];

  // Certificates tab table — server-paginated + sortable.
  const certFilters = {
    certificateType: typeFilter,
    search: search === '' ? undefined : search,
  };
  const certsTable = useTableQuery<OrgCertificate, typeof certFilters>({
    filters: certFilters,
    queryKey: (p) => ['org-certificates', 'list', p] as const,
    queryFn: (token, p) => listOrgCertificatesPage(token, p),
    initialSort: { key: 'valid_until', dir: 'asc' },
  });

  const deleteMutation = useDeleteOrgCertificate();

  const handleDownload = useCallback(
    async (cert: OrgCertificate) => {
      if (tokens === null) return;
      try {
        const resp = await getOrgCertificateDownloadUrl(tokens.access_token, cert.id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(t('list.downloadError'));
      }
    },
    [tokens, t],
  );

  const handleDelete = useCallback(
    (cert: OrgCertificate) => {
      deleteMutation.mutate(cert.id, {
        onSuccess: () => {
          toast.success(t('list.removeSuccess', { name: cert.original_filename }));
        },
      });
    },
    [deleteMutation, t],
  );

  const panelHeading = {
    overview: {
      eyebrow: t('panel.overviewEyebrow'),
      title: t('panel.overviewTitle'),
    },
    certificates: {
      eyebrow: t('panel.certificatesEyebrow'),
      title: t('panel.certificatesTitle', { count: certsTable.total }),
    },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<OrgCertificatesHero />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'certificates',
          label: t('tabs.certificates'),
          icon: <Table2 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{certsTable.total}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'certificates'}
      toolbar={
        tab === 'certificates' ? (
          <TableToolbar
            actions={
              <Button size="md" className="whitespace-nowrap" onClick={() => { setUploadOpen(true); }}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('list.uploadButton')}
              </Button>
            }
          >
            <SearchInput placeholder={t('list.searchPlaceholder')} value={search} onChange={setSearch} />
            <Select
              selectSize="md"
              value={typeFilter ?? 'all'}
              onChange={(e) => { setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as CertificateTypeValue); }}
            >
              {TYPE_OPTIONS.map(({ value, key }) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </Select>
          </TableToolbar>
        ) : undefined
      }
      afterTabs={
        <>
          <OrgCertificateUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
          <OrgCertificateViewerDialog
            certificate={viewingCert}
            open={viewingCert !== null}
            onOpenChange={(o) => { if (!o) setViewingCert(null); }}
          />
        </>
      }
    >
      <TabsContent value="overview" className="mt-0">
        {certsQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <OrgCertificatesOverview certificates={allCerts} onView={setViewingCert} />
        )}
      </TabsContent>

      <TabsContent value="certificates" className="mt-0 flex min-h-0 flex-1 flex-col">
        <OrgCertificatesTable
          table={certsTable}
          onDownload={(cert) => { void handleDownload(cert); }}
          onDelete={handleDelete}
          onView={setViewingCert}
        />
        <TablePaginationFooter
          table={certsTable}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
