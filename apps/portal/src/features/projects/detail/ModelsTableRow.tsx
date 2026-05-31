'use client';

import { Eye, ShieldCheck, Upload, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Badge, Button, Spinner } from '@bimstitch/ui';
import {
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
} from '@bimstitch/ui';

import type { FileTypeValue, Model, ProjectFile } from '@/lib/api/schemas';
import { useCheckCompliance } from '@/features/compliance/hooks';
import { useModelFiles } from '@/features/models/useModelFiles';
import { viewerKeys } from '@/features/viewer/queryKeys';
import { getViewerBundle } from '@/lib/api/projectFiles';
import { disciplineChipColors } from '@/lib/formatting/disciplineColors';
import { useAuth } from '@/providers/AuthProvider';

function formatRelativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('daysAgo', { count: days });
}

function fileExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

type FileTypePillProps = { fileType: FileTypeValue; schema?: string | null };

const PILL_VARIANT: Record<FileTypeValue, 'info' | 'error' | 'warning'> = {
  ifc: 'info',
  pdf: 'error',
  dxf: 'warning',
  dwg: 'warning',
};

function FileTypePill({ fileType, schema }: FileTypePillProps): JSX.Element {
  const label = fileType === 'ifc' ? (schema ?? 'IFC') : fileType.toUpperCase();
  return (
    <Badge variant={PILL_VARIANT[fileType]} size="sm" bordered={false} className="shrink-0 uppercase">
      {label}
    </Badge>
  );
}

type Props = {
  projectId: string;
  model: Model;
  isOpen: boolean;
  onToggle: () => void;
  onUpload: (modelId: string) => void;
};

export function ModelsTableRow({ projectId, model, isOpen, onToggle, onUpload }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.models.row');
  const filesQuery = useModelFiles(projectId, model.id);
  const complianceMutation = useCheckCompliance(projectId, model.id);
  const queryClient = useQueryClient();
  const { tokens } = useAuth();
  const files = filesQuery.data ?? [];
  const colors = disciplineChipColors(model.discipline);
  const latestFile = files.length > 0 ? files[0] : undefined;
  const isViewable = latestFile !== undefined && (
    latestFile.file_type === 'pdf'
      ? latestFile.status === 'ready'
      : latestFile.extraction_status === 'succeeded'
  );
  const canCheckBbl = latestFile?.file_type === 'ifc' && latestFile.extraction_status === 'succeeded';

  const viewHref = latestFile !== undefined
    ? `/projects/${projectId}/models/${model.id}/viewer/${latestFile.id}`
    : '';

  const prewarmViewer = useCallback(() => {
    if (!isViewable || latestFile === undefined || tokens === null) return;
    const accessToken = tokens.access_token;
    const fileId = latestFile.id;
    queryClient
      .prefetchQuery({
        queryKey: viewerKeys.bundle(projectId, model.id, fileId),
        queryFn: () => getViewerBundle(accessToken, projectId, model.id, fileId),
        staleTime: 60_000,
      })
      .catch(() => undefined);
    import('@bimstitch/viewer').catch(() => undefined);
  }, [isViewable, latestFile, tokens, queryClient, projectId, model.id]);

  return (
    <DetailCard expanded={isOpen} onToggle={onToggle}>
      <DetailCardRow
        media={
          <span
            className="shrink-0 rounded-sm px-1 py-px text-center text-micro font-bold"
            style={{ background: colors.bg, color: colors.fg, width: 30 }}
          >
            {model.discipline.slice(0, 4).toUpperCase()}
          </span>
        }
        actions={
          <>
            {isViewable && latestFile !== undefined ? (
              <Link
                href={viewHref}
                onClick={(e) => { e.stopPropagation(); }}
                onMouseEnter={prewarmViewer}
                onFocus={prewarmViewer}
                title={t('viewFile')}
                className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
              >
                <Eye className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                onClick={(e) => { e.stopPropagation(); }}
                title={t('noViewableFile')}
                className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
              title={t('uploadFile')}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="truncate text-body3 font-semibold leading-tight text-foreground">
          {model.name}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          {latestFile !== undefined ? (
            <>
              <FileTypePill fileType={latestFile.file_type} schema={latestFile.ifc_schema} />
              <span className="truncate">{latestFile.original_filename}</span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{(latestFile.size_bytes / 1048576).toFixed(0)} MB</span>
            </>
          ) : (
            <span>{t('noFiles')}</span>
          )}
          <span className="shrink-0">·</span>
          <span className="shrink-0">{files.length} {files.length === 1 ? 'version' : 'versions'}</span>
          {latestFile !== undefined && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatRelativeTime(latestFile.updated_at, t)}</span>
            </>
          )}
        </div>
      </DetailCardRow>

      <DetailCardBody>
        <div className="rounded-md border border-border bg-background">
          {files.length === 0 ? (
            <div className="px-3 py-4 text-center text-body3 text-foreground-tertiary">
              {t('noVersionsUploaded')}
            </div>
          ) : (
            files.map((f: ProjectFile, i: number) => {
              const isLatest = i === 0;
              const ext = fileExt(f.original_filename);
              return (
                <div
                  key={f.id}
                  className={`grid grid-cols-[110px_1fr] items-center px-3 py-1.5 text-body3 ${
                    i < files.length - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-sans font-bold">
                    <span className={isLatest ? 'text-primary' : 'text-foreground'}>
                      v{String(f.version_number).padStart(2, '0')}{ext}
                    </span>
                    {isLatest && (
                      <span className="rounded-sm bg-primary px-1.5 py-px text-caption font-bold text-primary-foreground">
                        {t('latest')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-caption text-foreground-tertiary">
                    <FileTypePill fileType={f.file_type} schema={f.ifc_schema} />
                    <span className="truncate">{f.original_filename} · {(f.size_bytes / 1048576).toFixed(0)} MB</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DetailCardBody>

      <DetailCardFooter className="justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {isViewable && latestFile !== undefined ? (
            <Link
              href={viewHref}
              onClick={(e) => { e.stopPropagation(); }}
              onMouseEnter={prewarmViewer}
              onFocus={prewarmViewer}
            >
              <Button variant="ghost" size="sm">
                <Eye className="h-3.5 w-3.5" />
                {t('view')}
              </Button>
            </Link>
          ) : latestFile !== undefined ? (
            <Button variant="ghost" size="sm" disabled>
              <Eye className="h-3.5 w-3.5" />
              {t('view')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onUpload(model.id); }}
          >
            <Upload className="h-3.5 w-3.5" />
            {t('upload')}
          </Button>
          {canCheckBbl && latestFile !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={complianceMutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                complianceMutation.mutate({ fileId: latestFile.id });
              }}
            >
              {complianceMutation.isPending ? (
                <Spinner size="sm" className="text-current" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {t('checkBbl')}
            </Button>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" className="text-error hover:text-error">
          <Trash2 className="h-3.5 w-3.5" />
          {t('remove')}
        </Button>
      </DetailCardFooter>
    </DetailCard>
  );
}
