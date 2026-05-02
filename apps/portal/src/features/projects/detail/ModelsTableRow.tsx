'use client';

import { Eye, Loader2, ShieldCheck, Upload, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useRouter } from '@/i18n/navigation';
import { useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type { Model, ProjectFile } from '@/lib/api/schemas';
import { useCheckCompliance } from '@/features/projects/compliance/hooks';
import { formatExtractionStatus } from '@/features/projects/fileFormatting';
import { useModelFiles } from '@/features/projects/useModelFiles';

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  architectural: { bg: '#ede8f7', fg: '#5a3fa6' },
  structural: { bg: '#e5edf7', fg: '#2c5697' },
  mep: { bg: '#f8ecd9', fg: '#a97428' },
  coordination: { bg: '#eaf6ef', fg: '#3f8f65' },
  other: { bg: '#f1f3f6', fg: '#4b5563' },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function fileExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

type FileTypePillProps = { fileType: 'ifc' | 'pdf'; schema?: string | null };

function FileTypePill({ fileType, schema }: FileTypePillProps): JSX.Element {
  const isPdf = fileType === 'pdf';
  const label = isPdf ? 'PDF' : (schema ?? 'IFC');
  return (
    <span
      className={`shrink-0 rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wide ${
        isPdf
          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
      }`}
    >
      {label}
    </span>
  );
}

type Props = {
  projectId: string;
  model: Model;
  onUpload: (modelId: string) => void;
};

export function ModelsTableRow({ projectId, model, onUpload }: Props): JSX.Element {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const filesQuery = useModelFiles(projectId, model.id);
  const complianceMutation = useCheckCompliance(projectId, model.id);
  const files = filesQuery.data ?? [];
  const colors = DISC_COLORS[model.discipline] ?? DISC_COLORS['other']!;
  const latestFile = files.length > 0 ? files[0] : undefined;
  const isViewable = latestFile !== undefined && (
    latestFile.file_type === 'pdf'
      ? latestFile.status === 'ready'
      : latestFile.extraction_status === 'succeeded'
  );
  const canCheckBbl = latestFile?.file_type === 'ifc' && latestFile.extraction_status === 'succeeded';

  return (
    <div className="border-b border-border">
      {/* Row */}
      <div
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_56px_88px_144px] items-center gap-4 px-4 py-3 text-body3 transition-colors ${
          isOpen
            ? 'border-l-[3px] border-l-primary bg-primary-lighter pl-[13px] dark:bg-white/5'
            : 'border-l-[3px] border-l-transparent hover:bg-background-hover'
        }`}
        onClick={() => { setIsOpen(!isOpen); }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`w-2 text-[9px] font-bold ${isOpen ? 'text-primary' : 'text-foreground-tertiary'}`}>
            {isOpen ? '▾' : '▸'}
          </span>
          <span
            className="shrink-0 rounded-sm px-1 py-px text-center text-[9.5px] font-bold"
            style={{ background: colors.bg, color: colors.fg, width: 30 }}
          >
            {model.discipline.slice(0, 4).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{model.name}</div>
            <div className="flex items-center gap-1.5 font-mono text-caption text-foreground-tertiary">
              {latestFile !== undefined ? (
                <>
                  <FileTypePill fileType={latestFile.file_type} schema={latestFile.ifc_schema} />
                  <span className="truncate">{latestFile.original_filename} · {(latestFile.size_bytes / 1048576).toFixed(0)} MB</span>
                </>
              ) : (
                'No files'
              )}
            </div>
          </div>
        </div>
        <span className="text-center font-mono text-body3 font-semibold tabular-nums">{files.length}</span>
        <span className="text-caption text-foreground-tertiary whitespace-nowrap">
          {latestFile !== undefined ? formatRelativeTime(latestFile.updated_at) : '—'}
        </span>
        <div className="flex justify-end gap-1.5">
          {!isOpen ? (
            <>
              <button
                type="button"
                disabled={!isViewable}
                onClick={(e) => {
                  e.stopPropagation();
                  if (latestFile !== undefined) {
                    router.push(`/projects/${projectId}/models/${model.id}/viewer/${latestFile.id}`);
                  }
                }}
                title={isViewable ? 'View file' : 'No viewable file yet'}
                className="inline-grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-secondary transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
                title="Upload file"
                className="inline-grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-secondary transition-colors hover:border-primary hover:text-primary"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
              {canCheckBbl ? (
                <button
                  type="button"
                  disabled={complianceMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (latestFile !== undefined) {
                      complianceMutation.mutate({ fileId: latestFile.id });
                    }
                  }}
                  title="Check BBL"
                  className="inline-grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-secondary transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {complianceMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </>
          ) : (
            <span className="text-caption font-semibold text-primary">▾ Open</span>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {isOpen && (
        <div className="border-l-[3px] border-l-primary bg-primary-lighter px-4 pb-4 pl-9 pt-2 dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-primary">
              Version history · {files.length} versions
            </span>
            <div className="flex flex-wrap gap-1.5">
              {isViewable && latestFile !== undefined ? (
                <Link
                  href={`/projects/${projectId}/models/${model.id}/viewer/${latestFile.id}`}
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <Button variant="border" size="sm">
                    <Eye className="mr-1.5 h-3 w-3" />
                    View
                  </Button>
                </Link>
              ) : latestFile !== undefined ? (
                <Button variant="border" size="sm" disabled>
                  <Eye className="mr-1.5 h-3 w-3" />
                  View
                </Button>
              ) : null}
              <Button
                variant="border"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
              >
                <Upload className="mr-1.5 h-3 w-3" />
                Upload
              </Button>
              {canCheckBbl && latestFile !== undefined ? (
                <Button
                  variant="border"
                  size="sm"
                  disabled={complianceMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    complianceMutation.mutate({ fileId: latestFile.id });
                  }}
                >
                  {complianceMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3 w-3" />
                  )}
                  Check BBL
                </Button>
              ) : null}
              <Button variant="border" size="sm" className="text-error hover:border-error">
                <Trash2 className="mr-1.5 h-3 w-3" />
                Remove
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-background">
            {files.length === 0 ? (
              <div className="px-3 py-4 text-center text-body3 text-foreground-tertiary">
                No versions uploaded yet.
              </div>
            ) : (
              files.map((f: ProjectFile, i: number) => {
                const isLatest = i === 0;
                const ext = fileExt(f.original_filename);
                return (
                  <div
                    key={f.id}
                    className={`grid grid-cols-[110px_1fr_90px_70px] items-center px-3 py-1.5 text-body3 ${
                      i < files.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-mono font-bold">
                      <span className={isLatest ? 'text-primary' : 'text-foreground'}>
                        v{String(f.version_number).padStart(2, '0')}{ext}
                      </span>
                      {isLatest && (
                        <span className="rounded-sm bg-primary px-1.5 py-px text-[9px] font-bold text-white">
                          LATEST
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-caption text-foreground-tertiary">
                      <FileTypePill fileType={f.file_type} schema={f.ifc_schema} />
                      <span className="truncate">{f.original_filename} · {(f.size_bytes / 1048576).toFixed(0)} MB</span>
                    </div>
                    <span className="text-caption text-foreground-tertiary">
                      {formatExtractionStatus(f.extraction_status)}
                    </span>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="px-2 text-caption">
                        Diff
                      </Button>
                      <Button variant="ghost" size="sm" className="px-2 text-caption">
                        ↓
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
