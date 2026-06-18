'use client';

import { LayoutGrid, Plus, Table2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Select, Skeleton, TabsContent } from '@bimstitch/ui';

import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { useClientPagination } from '@/lib/query/useTableQuery';

import { useDeleteFindingTemplate } from '@/features/findingTemplates/useDeleteFindingTemplate';
import { useSetDefaultFindingTemplate } from '@/features/findingTemplates/useSetDefaultFindingTemplate';
import {
  useDeleteReportTemplate,
  useSetDefaultReportTemplate,
} from '@/features/reportTemplates/hooks';

import { OrgTemplateBuilderDialog } from '@/features/orgTemplates/OrgTemplateBuilderDialog';
import { OrgTemplatesHero } from '@/features/orgTemplates/OrgTemplatesHero';
import { OrgTemplatesOverview } from '@/features/orgTemplates/OrgTemplatesOverview';
import { OrgTemplatesTable } from '@/features/orgTemplates/OrgTemplatesTable';
import { useAllTemplates, type UnifiedTemplateRow } from '@/features/orgTemplates/useAllTemplates';

import { useAuth } from '@/providers/AuthProvider';

const TYPE_FILTERS = ['all', 'findings', 'reports'] as const;
type TypeFilterValue = (typeof TYPE_FILTERS)[number];

export default function TemplatesPage(): JSX.Element {
  const t = useTranslations('orgTemplates');
  const { activeMembership, me } = useAuth();
  const canManage =
    activeMembership?.is_org_admin === true || me?.user.is_superuser === true;

  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilterValue>('all');

  // Unified builder
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UnifiedTemplateRow | null>(null);

  // Data
  const { templates, isLoading, findingTemplates, allReportTemplates, stats } = useAllTemplates();

  // Mutations — findings
  const deleteFindingMutation = useDeleteFindingTemplate();
  const setDefaultFindingMutation = useSetDefaultFindingTemplate();

  // Mutations — reports (one hook per type to satisfy invalidation keys)
  const deleteComplianceMutation = useDeleteReportTemplate('compliance_report');
  const deleteAssuranceMutation = useDeleteReportTemplate('assurance_plan');
  const deleteCompletionMutation = useDeleteReportTemplate('completion_declaration');
  const deleteDossierMutation = useDeleteReportTemplate('dossier');
  const setDefaultComplianceMutation = useSetDefaultReportTemplate('compliance_report');
  const setDefaultAssuranceMutation = useSetDefaultReportTemplate('assurance_plan');
  const setDefaultCompletionMutation = useSetDefaultReportTemplate('completion_declaration');
  const setDefaultDossierMutation = useSetDefaultReportTemplate('dossier');

  const reportDeleteMutations: Record<string, typeof deleteComplianceMutation> = {
    compliance_report: deleteComplianceMutation,
    assurance_plan: deleteAssuranceMutation,
    completion_declaration: deleteCompletionMutation,
    dossier: deleteDossierMutation,
  };
  const reportSetDefaultMutations: Record<string, typeof setDefaultComplianceMutation> = {
    compliance_report: setDefaultComplianceMutation,
    assurance_plan: setDefaultAssuranceMutation,
    completion_declaration: setDefaultCompletionMutation,
    dossier: setDefaultDossierMutation,
  };

  // Filter + search
  const filtered = useMemo(() => {
    let rows = templates;
    if (typeFilter === 'findings') rows = rows.filter((row) => row.kind === 'finding');
    else if (typeFilter === 'reports') rows = rows.filter((row) => row.kind === 'report');
    if (search.trim() !== '') {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => row.data.name.toLowerCase().includes(q));
    }
    return rows;
  }, [templates, typeFilter, search]);

  // Templates are merged client-side from multiple endpoints → client paging.
  const templatesTable = useClientPagination(filtered, {
    sortAccessors: {
      name: (row) => row.data.name,
      type: (row) => row.data.template_type,
      default: (row) => row.data.is_default,
      updated: (row) => row.data.updated_at,
    },
    initialSort: { key: 'name', dir: 'asc' },
    isLoading,
  });

  // Handlers
  const handleNew = (): void => {
    setEditTarget(null);
    setBuilderOpen(true);
  };

  const handleEdit = (row: UnifiedTemplateRow): void => {
    setEditTarget(row);
    setBuilderOpen(true);
  };

  const handleDelete = (row: UnifiedTemplateRow): void => {
    if (row.kind === 'finding') {
      deleteFindingMutation.mutate(row.data.id, {
        onSuccess: () => { toast.success(t('actions.removeSuccess', { name: row.data.name })); },
      });
    } else {
      const mutation = reportDeleteMutations[row.data.template_type];
      if (mutation !== undefined) {
        mutation.mutate(row.data.id, {
          onSuccess: () => { toast.success(t('actions.removeSuccess', { name: row.data.name })); },
          onError: () => { toast.error(t('actions.cannotDeleteDefault')); },
        });
      }
    }
  };

  const handleSetDefault = (row: UnifiedTemplateRow): void => {
    if (row.kind === 'finding') {
      setDefaultFindingMutation.mutate(row.data.id, {
        onSuccess: () => { toast.success(t('actions.setDefaultSuccess', { name: row.data.name })); },
      });
    } else {
      const mutation = reportSetDefaultMutations[row.data.template_type];
      if (mutation !== undefined) {
        mutation.mutate(row.data.id, {
          onSuccess: () => { toast.success(t('actions.setDefaultSuccess', { name: row.data.name })); },
        });
      }
    }
  };

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    templates: {
      eyebrow: t('panel.templatesEyebrow'),
      title: t('panel.templatesTitle', { count: templatesTable.total }),
    },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<OrgTemplatesHero stats={stats} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'templates',
          label: t('tabs.templates'),
          icon: <Table2 className="h-4 w-4" />,
          badge: (
            <Badge variant="primary" size="md" bordered={false}>
              {templates.length}
            </Badge>
          ),
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'templates'}
      toolbar={
        tab === 'templates' ? (
          <TableToolbar
            actions={
              canManage ? (
                <Button size="md" className="whitespace-nowrap" onClick={handleNew}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('actions.newButton')}
                </Button>
              ) : undefined
            }
          >
            <SearchInput placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} />
            <Select
              selectSize="md"
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value as TypeFilterValue); }}
              aria-label={t('typeFilter.aria')}
            >
              <option value="all">{t('typeFilter.all')}</option>
              <option value="findings">{t('typeFilter.findings')}</option>
              <option value="reports">{t('typeFilter.reports')}</option>
            </Select>
          </TableToolbar>
        ) : undefined
      }
      afterTabs={
        canManage ? (
          <OrgTemplateBuilderDialog
            open={builderOpen}
            onOpenChange={setBuilderOpen}
            editTarget={editTarget}
          />
        ) : undefined
      }
    >
      <TabsContent value="overview" className="mt-0">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <OrgTemplatesOverview
            findingTemplates={findingTemplates}
            reportTemplates={allReportTemplates}
            stats={stats}
          />
        )}
      </TabsContent>

      <TabsContent value="templates" className="mt-0 flex min-h-0 flex-1 flex-col">
        <OrgTemplatesTable
          table={templatesTable}
          canManage={canManage}
          onEdit={handleEdit}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
        />
        <TablePaginationFooter
          table={templatesTable}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
