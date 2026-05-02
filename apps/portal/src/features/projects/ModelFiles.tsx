'use client';

import {
  AlertTriangle,
  Box,
  Download,
  FileText,
  Loader2,
  MoreVertical,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type JSX,
} from 'react';

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  cn,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { getDownloadUrl } from '@/lib/api/projectFiles';
import type { ExtractionStatusValue, ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import {
  formatExtractionStatus,
  formatFileSize,
  formatRejection,
  formatSchemaLabel,
} from './fileFormatting';
import { UploadProgressItem, type UploadState } from './UploadProgressItem';
import { useCheckCompliance } from './compliance/hooks';
import { useDeleteModelFile } from './useDeleteModelFile';
import { useModelFiles } from './useModelFiles';
import { useRetryExtraction } from './useRetryExtraction';
import { useUploadModelFile } from './useUploadModelFile';

type Props = {
  projectId: string;
  modelId: string;
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

const ALL_EXTENSIONS = ['.ifc', '.pdf'] as const;

function isAllowedFile(file: File, lockedFileType: string | null): boolean {
  const lower = file.name.toLowerCase();
  if (lockedFileType !== null) {
    return lower.endsWith(`.${lockedFileType}`);
  }
  return ALL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function ExtractionBadge({
  status,
  error,
}: {
  status: ExtractionStatusValue;
  error: string | null;
}): JSX.Element | null {
  if (status === 'succeeded' || status === 'not_started') return null;
  if (status === 'queued' || status === 'running') {
    return (
      <span
        title={formatExtractionStatus(status)}
        className="inline-flex items-center gap-1 text-caption text-foreground-tertiary"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {formatExtractionStatus(status)}
      </span>
    );
  }
  return (
    <span
      title={error ?? 'Extraction failed.'}
      className="inline-flex items-center gap-1 text-caption text-error"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      Failed
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
          aria-label={`Retry extraction for ${file.original_filename}`}
          disabled={retryMutation.isPending}
          onClick={() => {
            retryMutation.mutate({ projectId, modelId, fileId: file.id });
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      ) : null}
      {file.extraction_status === 'succeeded' || (file.file_type === 'pdf' && file.status === 'ready') ? (
        <Link
          href={`/projects/${projectId}/models/${modelId}/viewer/${file.id}`}
          aria-label={`View ${file.original_filename}${file.file_type === 'ifc' ? ' in 3D' : ''}`}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          {file.file_type === 'ifc' ? (
            <><Box className="h-4 w-4" /> View 3D</>
          ) : (
            <><FileText className="h-4 w-4" /> View</>
          )}
        </Link>
      ) : null}
      {file.extraction_status === 'succeeded' && file.file_type === 'ifc' ? (
        <Button
          type="button"
          variant="border"
          size="sm"
          aria-label={`Check BBL compliance for ${file.original_filename}`}
          disabled={complianceMutation.isPending}
          onClick={() => {
            complianceMutation.mutate({ fileId: file.id });
          }}
        >
          {complianceMutation.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          )}
          Check BBL
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Download ${file.original_filename}`}
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
            aria-label="File actions"
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
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ModelFiles({ projectId, modelId }: Props): JSX.Element {
  const filesQuery = useModelFiles(projectId, modelId, 'all');
  const uploadMutation = useUploadModelFile();
  const deleteMutation = useDeleteModelFile();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const files = filesQuery.data ?? [];
  // Backend returns files ordered by version_number desc — so files[0] is the latest.
  const readyFiles = files.filter((f) => f.status === 'ready');
  const lockedFileType = useMemo(
    () => readyFiles[0]?.file_type ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filesQuery.data],
  );

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
    setPending((prev) => [...prev, { id, file, state: { kind: 'uploading' } }]);

    uploadMutation.mutate(
      { projectId, modelId, file },
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
          const message = error instanceof ApiError
            ? error.detail
            : 'Upload failed.';
          setPending((prev) => prev.map((p) => (
            p.id === id ? { ...p, state: { kind: 'error', message } } : p
          )));
        },
      },
    );
  }, [projectId, modelId, uploadMutation, lockedFileType]);

  const handleFiles = useCallback((files: FileList | null): void => {
    if (files === null) return;
    Array.from(files).forEach(startUpload);
  }, [startUpload]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    handleFiles(event.target.files);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

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

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => { setIsDragging(false); }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-background-secondary',
        )}
      >
        <UploadCloud className="h-6 w-6 text-foreground-tertiary" />
        <p className="text-body3 text-foreground">
          Drop a file here, or
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => {
            if (inputRef.current !== null) {
              inputRef.current.click();
            }
          }}
        >
          Choose file
        </Button>
        <p className="text-caption text-foreground-tertiary">
          {lockedFileType !== null
            ? <><span className="font-medium uppercase text-foreground-secondary">{lockedFileType}</span> only — locked by first upload</>
            : '.ifc and .pdf files'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={lockedFileType !== null ? `.${lockedFileType}` : '.ifc,.pdf'}
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {pending.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          {pending.map((p) => (
            <UploadProgressItem
              key={p.id}
              filename={p.file.name}
              sizeBytes={p.file.size}
              state={p.state}
              onRemove={p.state.kind === 'uploading' ? undefined : () => { dismissPending(p.id); }}
            />
          ))}
        </div>
      )}

      {filesQuery.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : null}

      {fileError === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
        >
          {fileError instanceof ApiError ? fileError.detail : 'Failed to load files.'}
        </div>
      )}

      {!filesQuery.isLoading && readyFiles.length === 0 && pending.length === 0 ? (
        <p className="px-1 text-caption text-foreground-tertiary">
          No versions yet. Upload a file to create the first version.
        </p>
      ) : null}

      {latest === undefined ? null : (
        <div className="flex flex-col">
          <span className="px-1 text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
            Latest version
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
            Older versions ({history.length})
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
            {rejectedFiles.length} rejected file{rejectedFiles.length === 1 ? '' : 's'}
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
                  aria-label={`Remove ${file.original_filename}`}
                  className="h-7 w-7 p-0"
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
        title="Delete file"
        description={
          deleteTarget === null
            ? ''
            : `Delete "${deleteTarget.original_filename}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
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
