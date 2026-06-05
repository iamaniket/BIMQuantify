'use client';

import { AlertTriangle, Box, Download, FileText, MoreVertical, RotateCcw, ShieldCheck, Trash2 } from '@bimstitch/ui/icons';
import { Link } from '@/i18n/navigation';
import {
  useCallback, useState, type JSX,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Spinner,
} from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { FileDropZone } from '@/components/shared/FileDropZone';

import { ApiError } from '@/lib/api/client';
import { getDownloadUrl } from '@/lib/api/projectFiles';
import type {
  ExtractionStatusValue,
  FileTypeValue,
  ProjectFile,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import {
  formatExtractionStatus,
  formatFileSize,
  formatRejection,
  formatSchemaLabel,
} from '@/lib/formatting/files';
import { UploadProgressItem, type UploadState } from './UploadProgressItem';
import { useCheckCompliance } from '@/features/compliance/hooks';
import { useDeleteModelFile } from './useDeleteModelFile';
import { acceptedExtensions, isAllowedFile } from './fileValidation';
import { useModelFiles } from './useModelFiles';
import { useRetryExtraction } from './useRetryExtraction';
import { useUploadModelFile } from './useUploadModelFile';

type Props = {
  projectId: string;
  modelId: string;
  primaryFileType: FileTypeValue | null;
};

type PendingUpload = {
  id: string;
  file: File;
  state: UploadState;
};

function nextUploadId(): string {
  return crypto.randomUUID();
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

function ExtractionBadge({
  status,
  error,
}: {
  status: ExtractionStatusValue;
  error: string | null;
}): JSX.Element | null {
  const t = useTranslations('projectDetail.tabs.models.files');
  if (status === 'succeeded' || status === 'not_started') return null;
  if (status === 'queued' || status === 'running') {
    return (
      <span
        title={formatExtractionStatus(status)}
        className="inline-flex items-center gap-1 text-caption text-foreground-tertiary"
      >
        <Spinner size="sm" className="text-foreground-tertiary" />
        {formatExtractionStatus(status)}
      </span>
    );
  }
  return (
    <span
      title={error ?? t('extractionFailed')}
      className="inline-flex items-center gap-1 text-caption text-error"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      {t('failed')}
    </span>
  );
}

function FileRow({
  projectId,
  modelId,
  file,
  onDeleteRequest,
}: {
  projectId: string;
  modelId: string;
  file: ProjectFile;
  onDeleteRequest: (file: ProjectFile) => void;
}): JSX.Element {
  const t = useTranslations('projectDetail.tabs.models.files');
  const { tokens } = useAuth();
  const retryMutation = useRetryExtraction();
  const complianceMutation = useCheckCompliance(projectId, modelId);

  const handleDownload = async (): Promise<void> => {
    if (tokens === null) return;
    try {
      const response = await getDownloadUrl(tokens.access_token, projectId, modelId, file.id);
      window.open(response.download_url, '_blank', 'noopener,noreferrer');
    } catch {
      // surfaced via list query
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <FileText className="h-5 w-5 text-foreground-secondary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body2 font-medium text-foreground">
          v{file.version_number} · {file.original_filename}
        </span>
        <span className="text-caption text-foreground-tertiary">
          {formatFileSize(file.size_bytes)}
          {' · '}
          {formatSchemaLabel(file.ifc_schema, file.file_type)}
          {' · uploaded '}
          {formatDate(file.created_at)}
        </span>
      </div>
      <ExtractionBadge status={file.extraction_status} error={file.extraction_error} />
      {file.extraction_status === 'failed' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('retryAria', { filename: file.original_filename })}
          disabled={retryMutation.isPending}
          onClick={() => {
            retryMutation.mutate({ projectId, modelId, fileId: file.id });
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {t('retry')}
        </Button>
      ) : null}
      {file.extraction_status === 'succeeded' || (file.file_type === 'pdf' && file.status === 'ready') ? (
        <Link
          href={`/projects/${projectId}/models/${modelId}/viewer/${file.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={file.file_type === 'ifc'
            ? t('viewAria3d', { filename: file.original_filename })
            : t('viewAria', { filename: file.original_filename })}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          {file.file_type === 'ifc' ? (
            <><Box className="h-4 w-4" /> {t('view3d')}</>
          ) : (
            <><FileText className="h-4 w-4" /> {t('view')}</>
          )}
        </Link>
      ) : null}
      {file.extraction_status === 'succeeded' && file.file_type === 'ifc' ? (
        <Button
          type="button"
          variant="border"
          size="sm"
          aria-label={t('checkBblAria', { filename: file.original_filename })}
          disabled={complianceMutation.isPending}
          onClick={() => {
            complianceMutation.mutate({ fileId: file.id });
          }}
        >
          {complianceMutation.isPending ? (
            <Spinner size="sm" className="mr-1.5 text-current" />
          ) : (
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('checkBbl')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('downloadAria', { filename: file.original_filename })}
        onClick={() => { handleDownload().catch(() => undefined); }}
      >
        <Download className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('fileActions')}
            className="h-8 w-8 p-0"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              onDeleteRequest(file);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ModelFiles({ projectId, modelId, primaryFileType }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.models.files');
  const filesQuery = useModelFiles(projectId, modelId, 'all');
  const uploadMutation = useUploadModelFile();
  const deleteMutation = useDeleteModelFile();

  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const files = filesQuery.data ?? [];
  // Backend returns files ordered by version_number desc — so files[0] is the latest.
  const readyFiles = files.filter((f) => f.status === 'ready');
  const lockedFileType: FileTypeValue | null = primaryFileType;

  const startUpload = useCallback((file: File): void => {
    if (!isAllowedFile(file, lockedFileType)) {
      const id = nextUploadId();
      setPending((prev) => [
        ...prev,
        { id, file, state: { kind: 'rejected', reason: 'INVALID_FILE_EXTENSION' } },
      ]);
      return;
    }

    const id = nextUploadId();
    setPending((prev) => [...prev, { id, file, state: { kind: 'hashing', fraction: 0 } }]);

    uploadMutation.mutate(
      {
        projectId,
        modelId,
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
                ? {
                  ...p,
                  state: {
                    kind: 'rejected',
                    reason: result.rejection_reason ?? 'UNKNOWN',
                  },
                }
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
              message = typeof msg === 'string'
                ? msg
                : t('duplicateContent');
            } else {
              message = error.detail;
            }
          } else {
            message = t('uploadFailed');
          }
          setPending((prev) => prev.map((p) => (
            p.id === id ? { ...p, state: { kind: 'error', message } } : p
          )));
        },
      },
    );
  }, [projectId, modelId, uploadMutation, lockedFileType, t]);

  const handleDeleteConfirm = (): void => {
    if (deleteTarget === null) return;
    deleteMutation.mutate(
      { projectId, modelId, fileId: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
        },
      },
    );
  };

  const dismissPending = (id: string): void => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

  const rejectedFiles = files.filter((f) => f.status === 'rejected');
  const latest = readyFiles[0];
  const history = readyFiles.slice(1);
  const fileError = filesQuery.error;

  const hasFiles = readyFiles.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {!hasFiles && (
        <FileDropZone
          accept={acceptedExtensions(lockedFileType).join(',')}
          multiple
          onFiles={(files) => { Array.from(files).forEach(startUpload); }}
          hint={
            lockedFileType !== null
              ? <><span className="font-medium uppercase text-foreground-secondary">{lockedFileType}</span> {t('hintLockedSuffix')}</>
              : t('hintAllTypes')
          }
        />
      )}

      {pending.length === 0 ? null : (
        <div className="flex flex-col gap-2">
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

      {filesQuery.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : null}

      {fileError === null ? null : (
        <ErrorBanner
          message={fileError instanceof ApiError ? fileError.detail : t('loadFailed')}
          tone="soft"
        />
      )}

      {!filesQuery.isLoading && readyFiles.length === 0 && pending.length === 0 ? (
        <p className="px-1 text-caption text-foreground-tertiary">
          {t('noVersions')}
        </p>
      ) : null}

      {latest === undefined ? null : (
        <div className="flex flex-col">
          <span className="px-1 text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
            {t('latestVersion')}
          </span>
          <ul className="flex flex-col rounded-md border border-border bg-background">
            <FileRow
              projectId={projectId}
              modelId={modelId}
              file={latest}
              onDeleteRequest={setDeleteTarget}
            />
          </ul>
        </div>
      )}

      {history.length === 0 ? null : (
        <details className="rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-4 py-2 text-body3 font-medium text-foreground-secondary">
            {t('olderVersions', { count: history.length })}
          </summary>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {history.map((file) => (
              <FileRow
                key={file.id}
                projectId={projectId}
                modelId={modelId}
                file={file}
                onDeleteRequest={setDeleteTarget}
              />
            ))}
          </ul>
        </details>
      )}

      {rejectedFiles.length === 0 ? null : (
        <details className="rounded-md border border-border bg-background px-4 py-2">
          <summary className="cursor-pointer text-body3 font-medium text-foreground-secondary">
            {t('rejectedFiles', { count: rejectedFiles.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {rejectedFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 text-caption text-foreground-tertiary"
              >
                <span className="truncate">{file.original_filename}</span>
                <span className="text-error">{formatRejection(file.rejection_reason)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('removeAria', { filename: file.original_filename })}
                  className="h-8 w-8 p-0"
                  onClick={() => { setDeleteTarget(file); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('deleteTitle')}
        description={
          deleteTarget === null
            ? ''
            : t('deleteDescription', { filename: deleteTarget.original_filename })
        }
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={handleDeleteConfirm}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={
          deleteMutation.error instanceof ApiError
            ? deleteMutation.error.detail
            : null
        }
      />
    </div>
  );
}
