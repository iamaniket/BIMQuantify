'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, type JSX } from 'react';

import { Badge, Button, Skeleton } from '@bimstitch/ui';

import { ComplianceByDomainCard } from '@/features/projects/detail/ComplianceByDomainCard';
import { ComplianceHealthCard } from '@/features/projects/detail/ComplianceHealthCard';
import { IssuesTab } from '@/features/projects/detail/IssuesTab';
import { RulesBreakdown } from '@/features/projects/detail/RulesBreakdown';
import {
  useComplianceArticles,
  useComplianceDomains,
  useComplianceIssues,
  useComplianceLatest,
  useComplianceSummary,
  useProjectReports,
} from '@/features/projects/compliance/hooks';
import { useModels } from '@/features/projects/useModels';
import { useProject } from '@/features/projects/useProject';

export default function ReportDetailPage(): JSX.Element {
  const t = useTranslations('reports.page');
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>();
  const search = useSearchParams();
  const framework = (search.get('framework') ?? 'bbl') as 'bbl' | 'wkb';
  const modelIdFromQuery = search.get('modelId') ?? undefined;

  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);
  const reportsQuery = useProjectReports(projectId, framework);

  // Fall back to looking up modelId from the reports list if it wasn't passed in.
  const modelId = useMemo(() => {
    if (modelIdFromQuery) return modelIdFromQuery;
    const match = reportsQuery.data?.find((r) => r.file_id === fileId);
    return match?.model_id;
  }, [modelIdFromQuery, reportsQuery.data, fileId]);

  const summaryQuery = useComplianceSummary(projectId, fileId, modelId);
  const domainsQuery = useComplianceDomains(projectId, fileId, modelId);
  const articlesQuery = useComplianceArticles(projectId, fileId, modelId);
  const issuesQuery = useComplianceIssues(projectId, fileId, modelId);
  const latestQuery = useComplianceLatest(projectId, fileId, modelId, framework);

  const reportMeta = reportsQuery.data?.find(
    (r) => r.file_id === fileId && r.framework === framework,
  );
  const summary = summaryQuery.data;
  const domains = domainsQuery.data ?? [];
  const articles = articlesQuery.data ?? [];
  const issues = issuesQuery.data ?? [];
  const project = projectQuery.data;
  const models = modelsQuery.data ?? [];
  const overallScore = summary?.overallScore ?? 0;
  const totalChecks =
    summary !== undefined ? summary.passCount + summary.warnCount + summary.failCount : 0;

  if (projectQuery.isLoading || (modelId === undefined && reportsQuery.isLoading)) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (modelId === undefined) {
    return (
      <main className="p-6">
        <Link href={`/projects/${projectId}`}>
          <Button variant="border" size="sm">
            <ArrowLeft className="mr-1.5 h-3 w-3" /> {t('backToProject')}
          </Button>
        </Link>
        <div
          role="alert"
          className="mt-4 rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {t('noReport', { framework: framework.toUpperCase() })}
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}`}>
            <Button variant="border" size="sm">
              <ArrowLeft className="mr-1.5 h-3 w-3" /> {t('backToProject')}
            </Button>
          </Link>
          <div>
            <div className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
              {t('title', { projectName: project?.name ?? 'Project' })}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={framework === 'bbl' ? 'default' : 'info'} className="uppercase">
                {framework}
              </Badge>
              {reportMeta !== undefined && (
                <span className="text-body3 font-semibold">
                  {reportMeta.model_name} · {reportMeta.file_name} (v
                  {String(reportMeta.file_version).padStart(2, '0')})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        {summary !== undefined ? (
          <>
            <ComplianceHealthCard summary={summary} holdbackAmount="—" embedded />
            <div className="border-t border-border" />
            <ComplianceByDomainCard
              domains={domains}
              articles={articles}
              models={models}
              trend={[]}
              overallScore={overallScore}
              totalChecks={totalChecks}
              failCount={summary.failCount}
              embedded
            />
          </>
        ) : (
          <div className="px-4 py-10 text-center text-body3 text-foreground-tertiary">
            {t('loadingResults')}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            {t('ruleBreakdownTitle')}
          </div>
          {latestQuery.data !== undefined && (
            <span className="text-caption text-foreground-tertiary">
              {t('elementsAndChecks', { elements: latestQuery.data.total_elements_checked, checks: latestQuery.data.details.length })}
            </span>
          )}
        </div>
        {latestQuery.data !== undefined ? (
          <RulesBreakdown
            rules={latestQuery.data.rules_summary}
            details={latestQuery.data.details}
          />
        ) : (
          <div className="px-3 py-6 text-center text-body3 text-foreground-tertiary">
            {t('loadingRules')}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
        <div className="mb-3 text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {t('issuesTitle', { count: issues.length })}
        </div>
        <IssuesTab issues={issues} />
      </div>
    </main>
  );
}
