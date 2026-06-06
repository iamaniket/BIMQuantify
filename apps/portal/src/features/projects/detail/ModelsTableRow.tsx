'use client';

import { Eye, ShieldCheck, Upload, Trash2 } from '@bimstitch/ui/icons';
import { Link } from '@/i18n/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback, useRef, useState, type ChangeEvent, type JSX,
} from 'react';
import { useTranslations } from 'next-intl';

import { Badge, Button, Spinner } from '@bimstitch/ui';
import {
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
} from '@bimstitch/ui';

import { FileDropZone } from '@/components/shared/FileDropZone';
import { VersionBadge, VersionHistoryList } from '@/components/shared/resource';
import { ApiError } from '@/lib/api/client';
import type { FileTypeValue, Model } from '@/lib/api/schemas';
import { useCheckCompliance } from '@/features/compliance/hooks';
import { acceptedExtensions, isAllowedFile } from '@/features/models/fileValidation';
import { useModelFiles } from '@/features/models/useModelFiles';
import { useUploadModelFile } from '@/features/models/useUploadModelFile';
import { UploadProgressItem, type UploadState } from '@/features/models/UploadProgressItem';
import { viewerKeys } from '@/features/viewer/shared/queryKeys';
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

type PendingUpload = {
  id: string;
  file: File;
  state: UploadState;
};

type Props = {
  projectId: string;
  model: Model;
  isOpen: boolean;
  onToggle: () => void;
};

export function ModelsTableRow({ projectId, model, isOpen, onToggle }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.models.row');
  const tFiles = useTranslations('projectDetail.tabs.models.files');
  const filesQuery = useModelFiles(projectId, model.id);
  const complianceMutation = useCheckCompliance(projectId, model.id);
  const uploadMutation = useUploadModelFile();
  const queryClient = useQueryClient();
  const { tokens } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const files = filesQuery.data ?? [];
  const colors = disciplineChipColors(model.discipline);
  const latestFile = files.length > 0 ? files[0] : undefined;
  const isViewable = latestFile !== undefined && (
    latestFile.file_type === 'pdf'
      ? latestFile.status === 'ready'
      : latestFile.extraction_status === 'succeeded'
  );
  const canCheckBbl = latestFile?.file_type === 'ifc' && latestFile.extraction_status === 'succeeded';
  const lockedFileType: FileTypeValue | null = model.primary_file_type ?? null;

  const viewHref = latestFile !== undefined
    ? `/projects/${projectId}/models/${model.id}/viewer/${latestFile.id}`
    : '';

  const startUpload = useCallback((file: File): void => {
    if (!isAllowedFile(file, lockedFileType)) {
      const id = crypto.randomUUID();
      setPending((prev) => [
        ...prev,
        { id, file, state: { kind: 'rejected', reason: 'INVALID_FILE_EXTENSION' } },
      ]);
      return;
    }

    const id = crypto.randomUUID();
    setPending((prev) => [...prev, { id, file, state: { kind: 'hashing', fraction: 0 } }]);

    uploadMutation.mutate(
      {
        projectId,
        modelId: model.id,
        file,
        onProgress: (event) => {
          setPending((prev) => prev.map((p) => {
            if (p.id !== id) return p;
            if (event.phase === 'hashing') {
              return { ...p, state: { kind: 'hashing', fraction: event.fraction } };
            }
            return { ...p, state: { kind: 'uploading' } };
          }));
        },
      },
      {
        onSuccess: (result) => {
          if (result.status === 'rejected') {
            setPending((prev) => prev.map((p) => (
              p.id === id
                ? { ...p, state: { kind: 'rejected', reason: result.rejection_reason ?? 'UNKNOWN' } }
                : p
            )));
            return;
          }
          setPending((prev) => prev.filter((p) => p.id !== id));
        },
        onError: (error) => {
          let message: string;
          if (error instanceof ApiError) {
            const obj = error.detailObject;
            if (obj !== null && obj['code'] === 'DUPLICATE_FILE_CONTENT') {
              const msg = obj['message'];
              message = typeof msg === 'string' ? msg : tFiles('duplicateContent');
            } else {
              message = error.detail;
            }
          } else {
            message = tFiles('uploadFailed');
          }
          setPending((prev) => prev.map((p) => (
            p.id === id ? { ...p, state: { kind: 'error', message } } : p
          )));
        },
      },
    );
  }, [projectId, model.id, uploadMutation, lockedFileType, tFiles]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files;
    if (chosen !== null) {
      Array.from(chosen).forEach(startUpload);
    }
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  };

  const dismissPending = (id: string): void => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-micro font-bold uppercase"
            style={{ background: colors.bg, color: colors.fg }}
          >
            {model.discipline.slice(0, 4)}
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
                <Eye className="h-4 w-4" />
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
                <Eye className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              title={t('uploadFile')}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Upload className="h-4 w-4" />
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={acceptedExtensions(lockedFileType).join(',')}
              multiple
              className="hidden"
              onChange={handleInputChange}
            />
          </>
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-body3 font-semibold leading-tight text-foreground">
            {model.name}
          </span>
          <VersionBadge version={latestFile?.version_number ?? 0} />
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
          {latestFile !== undefined && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatRelativeTime(latestFile.updated_at, t)}</span>
            </>
          )}
        </div>
      </DetailCardRow>

      <DetailCardBody>
        {files.length === 0 && (
          <FileDropZone
            accept={acceptedExtensions(lockedFileType).join(',')}
            multiple
            onFiles={(chosen) => { Array.from(chosen).forEach(startUpload); }}
            hint={
              lockedFileType !== null
                ? <><span className="font-medium uppercase text-foreground-secondary">{lockedFileType}</span> {tFiles('hintLockedSuffix')}</>
                : tFiles('hintAllTypes')
            }
          />
        )}

        {pending.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {pending.map((p) => (
              <UploadProgressItem
                key={p.id}
                filename={p.file.name}
                sizeBytes={p.file.size}
                state={p.state}
                onRemove={p.state.kind === 'uploading' || p.state.kind === 'hashing' ? undefined : () => { dismissPending(p.id); }}
              />
            ))}
          </div>
        )}

        <VersionHistoryList
          versions={files.map((f) => ({
            id: f.id,
            versionNumber: f.version_number,
            filename: f.original_filename,
            sizeBytes: f.size_bytes,
            createdAt: f.created_at,
          }))}
          isLoading={filesQuery.isLoading}
        />
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
                <Eye className="h-4 w-4" />
                {t('view')}
              </Button>
            </Link>
          ) : latestFile !== undefined ? (
            <Button variant="ghost" size="sm" disabled>
              <Eye className="h-4 w-4" />
              {t('view')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          >
            <Upload className="h-4 w-4" />
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
                <ShieldCheck className="h-4 w-4" />
              )}
              {t('checkBbl')}
            </Button>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" className="text-error hover:text-error">
          <Trash2 className="h-4 w-4" />
          {t('remove')}
        </Button>
      </DetailCardFooter>
    </DetailCard>
  );
}
