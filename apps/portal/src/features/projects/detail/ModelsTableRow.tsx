'use client';

import { Eye, Upload, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { Button, Progress } from '@bimstitch/ui';

import type { Model, ProjectFile } from '@/lib/api/schemas';
import { useModelFiles } from '@/features/projects/useModelFiles';

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  architectural: { bg: '#ede8f7', fg: '#5a3fa6' },
  structural: { bg: '#e5edf7', fg: '#2c5697' },
  mep: { bg: '#f8ecd9', fg: '#a97428' },
  coordination: { bg: '#eaf6ef', fg: '#3f8f65' },
  other: { bg: '#f1f3f6', fg: '#4b5563' },
};

type Props = {
  projectId: string;
  model: Model;
  onUpload: (modelId: string) => void;
};

export function ModelsTableRow({ projectId, model, onUpload }: Props): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const filesQuery = useModelFiles(projectId, model.id);
  const files = filesQuery.data ?? [];
  const score = 70 + Math.floor(model.name.length % 30);
  const statusColor = score > 90 ? 'success' : score > 75 ? 'warning' : 'error';
  const colors = DISC_COLORS[model.discipline] ?? DISC_COLORS['other']!;
  const latestFile = files.length > 0 ? files[0] : undefined;

  return (
    <div className="border-b border-border">
      {/* Row */}
      <div
        className={`grid cursor-pointer grid-cols-[1fr_50px_100px_60px_90px] items-center px-4 py-2.5 text-body3 transition-colors ${
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
            <div className="font-mono text-caption text-foreground-tertiary">
              {latestFile !== undefined
                ? `${latestFile.original_filename} · ${(latestFile.size_bytes / 1048576).toFixed(0)} MB`
                : 'No files'}
            </div>
          </div>
        </div>
        <span className="font-mono text-body3 font-semibold tabular-nums">{files.length}</span>
        <div className="flex items-center gap-1.5">
          <Progress value={score} variant={statusColor} className="w-12" />
          <span className={`text-body3 font-bold tabular-nums text-${statusColor}`}>{score}</span>
        </div>
        <span className="text-caption text-foreground-tertiary">
          {latestFile !== undefined ? '2h ago' : '—'}
        </span>
        <div className="flex justify-end gap-1.5">
          {!isOpen ? (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); }}
                title="View in 3D"
                className="inline-grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-secondary transition-colors hover:border-primary hover:text-primary"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
                title="Upload IFC"
                className="inline-grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-secondary transition-colors hover:border-primary hover:text-primary"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <span className="text-caption font-semibold text-primary">▾ Open</span>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {isOpen && (
        <div className="border-l-[3px] border-l-primary bg-primary-lighter px-4 pb-3.5 pl-9 dark:bg-white/[0.03]">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-primary">
              IFC version history · {files.length} versions
            </span>
            <div className="flex gap-1.5">
              {latestFile !== undefined && (
                <Link
                  href={`/projects/${projectId}/models/${model.id}/viewer/${latestFile.id}`}
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <Button variant="border" size="sm">
                    <Eye className="mr-1.5 h-3 w-3" />
                    View
                  </Button>
                </Link>
              )}
              <Button
                variant="border"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
              >
                <Upload className="mr-1.5 h-3 w-3" />
                Upload
              </Button>
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
                return (
                  <div
                    key={f.id}
                    className={`grid grid-cols-[110px_1fr_90px_70px] items-center px-3 py-1.5 text-body3 ${
                      i < files.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <span className={`font-mono font-bold ${isLatest ? 'text-primary' : 'text-foreground'}`}>
                      v{String(f.version_number).padStart(2, '0')}.ifc
                      {isLatest && (
                        <span className="ml-1.5 rounded-sm bg-primary px-1.5 py-px text-[9px] font-bold text-white">
                          LATEST
                        </span>
                      )}
                    </span>
                    <span className="text-caption text-foreground-tertiary">
                      {f.original_filename} · {(f.size_bytes / 1048576).toFixed(0)} MB
                    </span>
                    <span className="text-caption text-foreground-tertiary">
                      {f.extraction_status}
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
