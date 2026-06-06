'use client';

import { LayoutGrid, Plus, Table2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { PageTableContent, SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { PanelHeading } from '@/components/shared/PanelHeading';
import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';

import { PageShell } from '@/components/shared/layout/PageShell';
import { getOrgCertificateDownloadUrl } from '@/lib/api/orgCertificates';
import type { CertificateTypeValue, OrgCertificate } from '@/lib/api/schemas';
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

  const certsQuery = useOrgCertificates(typeFilter, search);
  const deleteMutation = useDeleteOrgCertificate();
  const certificates = certsQuery.data ?? [];

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
      title: t('panel.certificatesTitle', { count: certificates.length }),
    },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <PageShell hero={<OrgCertificatesHero />}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Underline tabs */}
        <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
          <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
            <LayoutGrid className="h-4 w-4" />
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="certificates" className={TAB_TRIGGER_CLASS}>
            <Table2 className="h-4 w-4" />
            {t('tabs.certificates')}
            <Badge variant="primary" size="sm" bordered={false}>
              {certificates.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <PanelHeading eyebrow={panelHeading.eyebrow} title={panelHeading.title} />

        {/* Toolbar for certificates tab */}
        {tab === 'certificates' && (
          <TableToolbar
            actions={
              <Button size="sm" className="whitespace-nowrap" onClick={() => { setUploadOpen(true); }}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('list.uploadButton')}
              </Button>
            }
          >
            <SearchInput placeholder={t('list.searchPlaceholder')} value={search} onChange={setSearch} />
            <Select
              selectSize="sm"
              value={typeFilter ?? 'all'}
              onChange={(e) => { setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as CertificateTypeValue); }}
            >
              {TYPE_OPTIONS.map(({ value, key }) => (
                <option key={value} value={value}>{(key)}</option>
              ))}
            </Select>
          </TableToolbar>
        )}

        {/* Scrollable tab content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="overview" className="mt-0">
            {certsQuery.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <OrgCertificatesOverview certificates={certificates} />
            )}
          </TabsContent>

          <TabsContent value="certificates" className="mt-0">
            <PageTableContent isLoading={certsQuery.isLoading} isError={false} errorMessage="" countLabel={t('panel.showing', { count: certificates.length })}>
              <OrgCertificatesTable
                certificates={certificates}
                onDownload={(cert) => { void handleDownload(cert); }}
                onDelete={handleDelete}
                onView={setViewingCert}
              />
            </PageTableContent>
          </TabsContent>
        </div>
      </Tabs>

      <OrgCertificateUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />

      <OrgCertificateViewerDialog
        certificate={viewingCert}
        open={viewingCert !== null}
        onOpenChange={(o) => { if (!o) setViewingCert(null); }}
      />
    </PageShell>
  );
}
