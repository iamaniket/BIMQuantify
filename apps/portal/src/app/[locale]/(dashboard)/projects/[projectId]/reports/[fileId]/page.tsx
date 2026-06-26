'use client';

import { ArrowLeft, Download } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Button, Eyebrow, Skeleton } from '@bimdossier/ui';
import { ErrorBanner } from '@/components/shared/ErrorBanner';

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
} from '@/features/compliance/hooks';
import { useDocuments } from '@/features/documents/useDocuments';
import { useProject } from '@/features/projects/useProject';
import { triggerBrowserDownload } from '@/lib/api/client';
import { downloadComplianceCsv, downloadComplianceRulesCsv } from '@/lib/api/compliance';
import { useAuth } from '@/providers/AuthProvider';

export default function ReportDetailPage(): JSX.Element {
  const t = useTranslations('reports.page');
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>();
  const search = useSearchParams();
  const framework = (search.get('framework') ?? 'bbl') as 'bbl' | 'wkb';
  const modelIdFromQuery = search.get('modelId') ?? undefined;

  const projectQuery = useProject(projectId);
  const modelsQuery = useDocuments(projectId);
  const reportsQuery = useProjectReports(projectId, framework);
  const { tokens } = useAuth();

  // Fall back to looking up modelId from the reports list if it wasn't passed in.
  const modelId = useMemo(() => {
    if (modelIdFromQuery) return modelIdFromQuery;
    const match = reportsQuery.data?.find((r) => r.file_id === fileId);
    return match?.document_id;
  }, [modelIdFromQuery, reportsQuery.data, fileId]);

  const summaryQuery = useComplianceSummary(projectId, fileId, modelId);
  const domainsQuery = useComplianceDomains(projectId, fileId, modelId);
  const articlesQuery = useComplianceArticles(projectId, fileId, modelId);
  const issuesQuery = useComplianceIssues(projectId, fileId, modelId);
  const latestQuery = useComplianceLatest(projectId, fileId, modelId, framework);

  const [rulesDownloading, setRulesDownloading] = useState(false);
  const [rulesDownloadError, setRulesDownloadError] = useState<string | null>(null);

  const handleDownloadRulesCsv = async (): Promise<void> => {
    if (tokens === null || modelId === undefined) return;
    setRulesDownloadError(null);
    setRulesDownloading(true);
    try {
      const { blob, filename } = await downloadComplianceRulesCsv(
        tokens.access_token,
        projectId,
        modelId,
        fileId,
        framework,
      );
      triggerBrowserDownload(blob, filename ?? `compliance-rules-${framework}-${fileId}.csv`);
    } catch {
      setRulesDownloadError(t('downloadCsvError'));
    } finally {
      setRulesDownloading(false);
    }
  };

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
          <Button variant="border" size="md">
            <ArrowLeft className="mr-1.5 h-3 w-3" /> {t('backToProject')}
          </Button>
        </Link>
        <ErrorBanner message={t('noReport', { framework: framework.toUpperCase() })} tone="soft" className="mt-4 text-body2" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}`}>
            <Button variant="border" size="md">
              <ArrowLeft className="mr-1.5 h-3 w-3" /> {t('backToProject')}
            </Button>
          </Link>
          <div>
            <Eyebrow as="div" tone="tertiary">
              {t('title', { projectName: project?.name ?? 'Project' })}
            </Eyebrow>
            <div className="flex items-center gap-2">
              <Badge variant={framework === 'bbl' ? 'default' : 'info'} className="uppercase">
                {framework}
              </Badge>
              {reportMeta !== undefined && (
                <span className="text-body3 font-semibold">
                  {reportMeta.document_name} · {reportMeta.file_name} (v
                  {String(reportMeta.file_version).padStart(2, '0')})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
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
        ) : summaryQuery.isError ? (
          <div className="px-4 py-10 text-center">
            <ErrorBanner message={t('loadFailed')} tone="soft" className="text-body2" />
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-body3 text-foreground-tertiary">
            {t('loadingResults')}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Eyebrow as="div" tone="tertiary">
            {t('ruleBreakdownTitle')}
          </Eyebrow>
          <div className="flex items-center gap-3">
            {latestQuery.data !== undefined && (
              <span className="text-caption text-foreground-tertiary">
                {t('elementsAndChecks', { elements: latestQuery.data.total_elements_checked, checks: latestQuery.data.details.length })}
              </span>
            )}
            {tokens !== null && modelId !== undefined && (
              <Button
                variant="border"
                size="md"
                onClick={() => { void handleDownloadRulesCsv(); }}
                disabled={
                  rulesDownloading
                  || latestQuery.data === undefined
                  || latestQuery.data.rules_summary.length === 0
                }
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t('downloadRulesCsv')}
              </Button>
            )}
          </div>
        </div>
        <ErrorBanner message={rulesDownloadError} tone="soft" className="mb-2 py-1.5 text-caption" />
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

      <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <Eyebrow as="div" tone="tertiary" className="mb-3">
          {t('issuesTitle', { count: issues.length })}
        </Eyebrow>
        {tokens === null ? (
          <IssuesTab issues={issues} />
        ) : (
          <IssuesTab
            issues={issues}
            onDownloadCsv={async () => {
              const { blob, filename } = await downloadComplianceCsv(
                tokens.access_token,
                projectId,
                modelId,
                fileId,
                framework,
              );
              triggerBrowserDownload(blob, filename ?? `compliance-${framework}-${fileId}.csv`);
            }}
          />
        )}
      </div>
    </main>
  );
}
