'use client';

import { ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Button } from '@bimstitch/ui';

import { useProjectReports, useCheckCompliance } from '@/features/projects/compliance/hooks';
import { useModelFiles } from '@/features/projects/useModelFiles';
import type { Model, ProjectComplianceReportItem, ProjectFile } from '@/lib/api/schemas';

type Framework = 'all' | 'bbl' | 'wkb';

const FRAMEWORK_FILTERS: { value: Framework; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bbl', label: 'BBL' },
  { value: 'wkb', label: 'WKB' },
];

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  architectural: { bg: '#ede8f7', fg: '#5a3fa6' },
  structural: { bg: '#e5edf7', fg: '#2c5697' },
  mep: { bg: '#f8ecd9', fg: '#a97428' },
  coordination: { bg: '#eaf6ef', fg: '#3f8f65' },
  other: { bg: '#f1f3f6', fg: '#4b5563' },
};

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function scoreTone(score: number): 'success' | 'warning' | 'error' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'error';
}

type Props = {
  projectId: string;
  models: Model[];
};

export function ReportsTab({ projectId, models }: Props): JSX.Element {
  const [framework, setFramework] = useState<Framework>('all');
  const reportsQuery = useProjectReports(
    projectId,
    framework === 'all' ? undefined : framework,
  );

  const reports = reportsQuery.data ?? [];

  const reportedFileIds = useMemo(
    () => new Set(reports.map((r) => `${r.file_id}:${r.framework}`)),
    [reports],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border border-border">
          {FRAMEWORK_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => { setFramework(f.value); }}
              className={`px-3 py-1 text-caption font-semibold transition-colors ${
                framework === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground-secondary hover:bg-background-hover'
              } ${f.value !== 'all' ? 'border-l border-border' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-caption text-foreground-tertiary">
          {reports.length} report{reports.length === 1 ? '' : 's'}
        </span>
      </div>

      {reportsQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-background px-3 py-6 text-center text-body3 text-foreground-tertiary">
          Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-foreground-tertiary" />
          <div className="text-body3 font-semibold">No reports yet</div>
          <div className="mt-1 text-caption text-foreground-tertiary">
            Run a BBL or WKB check on a processed IFC to generate a report.
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background">
          <div className="grid grid-cols-[60px_minmax(0,1fr)_60px_72px_72px_72px_140px] items-center gap-2 px-3 py-2 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
            <span>Reg.</span>
            <span>Model / File</span>
            <span className="text-right">Score</span>
            <span className="text-right">Pass</span>
            <span className="text-right">Warn</span>
            <span className="text-right">Fail</span>
            <span className="text-right">Actions</span>
          </div>
          {reports.map((r) => (
            <ReportRow key={`${r.file_id}-${r.framework}`} projectId={projectId} report={r} />
          ))}
        </div>
      )}

      <ModelsWithoutReports
        projectId={projectId}
        models={models}
        framework={framework === 'all' ? 'bbl' : framework}
        reportedKeys={reportedFileIds}
      />
    </div>
  );
}

function ReportRow({
  projectId,
  report,
}: {
  projectId: string;
  report: ProjectComplianceReportItem;
}): JSX.Element {
  const colors = DISC_COLORS[report.model_discipline] ?? DISC_COLORS['other']!;
  const tone = scoreTone(report.overall_score);
  return (
    <div className="grid grid-cols-[60px_minmax(0,1fr)_60px_72px_72px_72px_140px] items-center gap-2 border-t border-border px-3 py-2 text-body3">
      <Badge variant={report.framework === 'bbl' ? 'default' : 'info'} className="w-fit uppercase">
        {report.framework}
      </Badge>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 rounded-sm px-1 py-px text-[9px] font-bold"
            style={{ background: colors.bg, color: colors.fg }}
          >
            {report.model_discipline.slice(0, 4).toUpperCase()}
          </span>
          <span className="truncate font-semibold text-foreground">{report.model_name}</span>
          <span className="shrink-0 font-mono text-caption text-foreground-tertiary">
            v{String(report.file_version).padStart(2, '0')}
          </span>
        </div>
        <div className="truncate font-mono text-caption text-foreground-tertiary">
          {report.file_name} · {formatRelative(report.finished_at)}
        </div>
      </div>
      <Badge variant={tone} className="ml-auto w-fit tabular-nums">
        {report.overall_score}%
      </Badge>
      <span className="text-right tabular-nums text-success">{report.pass_count}</span>
      <span className="text-right tabular-nums text-warning">{report.warn_count}</span>
      <span className="text-right tabular-nums text-error">{report.fail_count}</span>
      <div className="flex justify-end gap-1.5">
        <Link
          href={`/projects/${projectId}/reports/${report.file_id}?framework=${report.framework}&modelId=${report.model_id}`}
        >
          <Button variant="border" size="sm">
            <ExternalLink className="mr-1.5 h-3 w-3" />
            View
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ModelsWithoutReports({
  projectId,
  models,
  framework,
  reportedKeys,
}: {
  projectId: string;
  models: Model[];
  framework: 'bbl' | 'wkb';
  reportedKeys: Set<string>;
}): JSX.Element | null {
  if (models.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="px-3 py-2 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
        Run a check
      </div>
      {models.map((m) => (
        <RunCheckRow
          key={m.id}
          projectId={projectId}
          model={m}
          framework={framework}
          reportedKeys={reportedKeys}
        />
      ))}
    </div>
  );
}

function RunCheckRow({
  projectId,
  model,
  framework,
  reportedKeys,
}: {
  projectId: string;
  model: Model;
  framework: 'bbl' | 'wkb';
  reportedKeys: Set<string>;
}): JSX.Element {
  const filesQuery = useModelFiles(projectId, model.id);
  const mutation = useCheckCompliance(projectId, model.id);
  const files = filesQuery.data ?? [];
  const latest: ProjectFile | undefined = files[0];
  const canCheck =
    latest !== undefined &&
    latest.file_type === 'ifc' &&
    latest.extraction_status === 'succeeded';
  const alreadyHasReport =
    latest !== undefined && reportedKeys.has(`${latest.id}:${framework}`);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-3 py-2 text-body3">
      <div className="min-w-0">
        <div className="truncate font-semibold">{model.name}</div>
        <div className="truncate font-mono text-caption text-foreground-tertiary">
          {latest !== undefined
            ? `${latest.original_filename} · ${latest.extraction_status}`
            : 'No files'}
        </div>
      </div>
      <Button
        variant="border"
        size="sm"
        disabled={!canCheck || mutation.isPending}
        onClick={() => {
          if (latest !== undefined) {
            mutation.mutate({ fileId: latest.id, buildingType: 'all' });
          }
        }}
        title={
          !canCheck
            ? 'Upload and process an IFC file first'
            : alreadyHasReport
              ? `Re-run ${framework.toUpperCase()} check`
              : `Run ${framework.toUpperCase()} check`
        }
      >
        {mutation.isPending ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1.5 h-3 w-3" />
        )}
        {alreadyHasReport ? 'Re-run' : 'Run'} {framework.toUpperCase()}
      </Button>
    </div>
  );
}
