'use client';

import { LayoutGrid, Plus, Table2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Skeleton, TabsContent } from '@bimstitch/ui';

import { PageTableContent, SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';

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

const ALL_TYPE_FILTERS = [
  'all',
  'findings',
  'compliance_report',
  'assurance_plan',
  'completion_declaration',
  'dossier',
] as const;
type TypeFilterValue = (typeof ALL_TYPE_FILTERS)[number];

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
    if (typeFilter !== 'all') {
      rows = rows.filter((row) =>
        typeFilter === 'findings'
          ? row.kind === 'finding'
          : row.data.template_type === typeFilter,
      );
    }
    if (search.trim() !== '') {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => row.data.name.toLowerCase().includes(q));
    }
    return rows;
  }, [templates, typeFilter, search]);

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
      title: t('panel.templatesTitle', { count: filtered.length }),
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
            <div className="flex flex-wrap gap-1.5">
              {ALL_TYPE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => { setTypeFilter(filter); }}
                  className={
                    filter === typeFilter
                      ? 'rounded-md border border-primary bg-primary-lighter px-2.5 py-1 font-sans text-caption font-medium text-primary'
                      : 'rounded-md border border-border bg-background px-2.5 py-1 font-sans text-caption text-foreground-secondary transition-colors hover:bg-background-hover'
                  }
                >
                  {t(`typeFilter.${filter}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
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

      <TabsContent value="templates" className="mt-0">
        <PageTableContent
          isLoading={isLoading}
          isError={false}
          errorMessage=""
          countLabel={t('panel.showing', { count: filtered.length })}
        >
          <OrgTemplatesTable
            templates={filtered}
            canManage={canManage}
            onEdit={handleEdit}
            onSetDefault={handleSetDefault}
            onDelete={handleDelete}
          />
        </PageTableContent>
      </TabsContent>
    </TabbedPageShell>
  );
}
