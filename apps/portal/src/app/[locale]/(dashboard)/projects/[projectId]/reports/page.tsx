'use client';

import { LayoutGrid, Search, Table2 } from '@bimstitch/ui/icons';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import {
  Badge, Input, Select, Skeleton, TabsContent,
} from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { useProjectPermissions } from '@/features/permissions';
import { useReports } from '@/features/reports/hooks';
import { ReportGenerateButtons } from '@/features/reports/ReportGenerateButtons';
import { ReportPreviewDrawer } from '@/features/reports/ReportPreviewDrawer';
import { ReportsPageHero } from '@/features/reports/ReportsPageHero';
import { ReportsOverviewTab } from '@/features/reports/tabs/ReportsOverviewTab';
import { ReportsTable, type ReportRow } from '@/features/reports/ReportsTable';
import { REPORT_TYPE_ORDER } from '@/features/reports/reportTypeMeta';
import { useProject } from '@/features/projects/useProject';
import { ApiError } from '@/lib/api/client';
import { useClientPagination } from '@/lib/query/useTableQuery';
import type { ReportType } from '@/lib/api/schemas/reports';

/**
 * Dedicated per-project Reports page — the "hero + tabbed" pattern shared with
 * Findings / Certificates. Overview tab (stats + charts) plus a flat,
 * one-row-per-version Reports list that's client-side paginated / sorted /
 * searched over the already-fetched report list (volume per project is low).
 */
export default function ProjectReportsPage(): JSX.Element {
  const t = useTranslations('reports.hub');
  const tReports = useTranslations('reports');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ReportType | undefined>(undefined);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const projectQuery = useProject(projectId);
  const reportsQuery = useReports(projectId);
  const { can } = useProjectPermissions(projectId);
  const canGenerate = can('report', 'create');

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

  const allReports = useMemo(() => reportsQuery.data?.items ?? [], [reportsQuery.data]);

  // Annotate each report with a 1-based version number within its type. The
  // list is newest-first, so the first occurrence of a type is its highest
  // version and the count decreases as we walk older generations.
  const annotated = useMemo<ReportRow[]>(() => {
    const totals = new Map<ReportType, number>();
    for (const r of allReports) totals.set(r.report_type, (totals.get(r.report_type) ?? 0) + 1);
    const seen = new Map<ReportType, number>();
    return allReports.map((report) => {
      const total = totals.get(report.report_type) ?? 1;
      const index = seen.get(report.report_type) ?? 0;
      seen.set(report.report_type, index + 1);
      return { ...report, versionNumber: total - index };
    });
  }, [allReports]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return annotated.filter((r) => {
      if (typeFilter !== undefined && r.report_type !== typeFilter) return false;
      if (query !== '') {
        const title = tReports(`types.${r.report_type}.title`).toLowerCase();
        if (!title.includes(query) && !r.title.toLowerCase().includes(query)) return false;
      }
      return true;
    });
  }, [annotated, search, typeFilter, tReports]);

  const table = useClientPagination<ReportRow>(filtered, {
    sortAccessors: {
      type: (r) => r.report_type,
      status: (r) => r.status,
      created_at: (r) => r.created_at,
      size: (r) => r.byte_size ?? 0,
    },
    initialSort: { key: 'created_at', dir: 'desc' },
    isLoading: reportsQuery.isLoading,
    isError: reportsQuery.isError,
  });

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
    reports: { eyebrow: t('panel.reportsEyebrow'), title: t('panel.reportsTitle', { count: table.total }) },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<ReportsPageHero projectName={project.name} reports={allReports} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'reports',
          label: t('tabs.reports'),
          icon: <Table2 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{table.total}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'reports'}
      toolbar={(tab === 'reports' || canGenerate) ? (
        // Single non-wrapping row: the search field flexes (grows/shrinks to
        // absorb leftover space) while the filter and the four generate buttons
        // stay fixed-width and never wrap to a second line.
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          {tab === 'reports' ? (
            <>
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
                <Input
                  inputSize="md"
                  className="w-full pl-9"
                  placeholder={t('list.searchPlaceholder')}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); }}
                  aria-label={t('list.searchPlaceholder')}
                />
              </div>
              <Select
                selectSize="md"
                className="w-auto shrink-0"
                value={typeFilter ?? 'all'}
                onChange={(e) => {
                  setTypeFilter(e.target.value === 'all' ? undefined : e.target.value as ReportType);
                }}
              >
                <option value="all">{t('list.filterAll')}</option>
                {REPORT_TYPE_ORDER.map((rt) => (
                  <option key={rt} value={rt}>{tReports(`types.${rt}.title`)}</option>
                ))}
              </Select>
            </>
          ) : (
            <div className="flex-1" />
          )}
          <ReportGenerateButtons projectId={projectId} onGenerated={setPreviewId} />
        </div>
      ) : undefined}
      afterTabs={(
        <ReportPreviewDrawer
          projectId={projectId}
          reportId={previewId}
          onClose={() => { setPreviewId(null); }}
        />
      )}
    >
      <TabsContent value="overview" className="mt-0">
        {reportsQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ReportsOverviewTab reports={allReports} />
        )}
      </TabsContent>

      <TabsContent value="reports" className="mt-0 flex min-h-0 flex-1 flex-col">
        <ReportsTable projectId={projectId} table={table} onView={setPreviewId} />
        <TablePaginationFooter
          table={table}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
