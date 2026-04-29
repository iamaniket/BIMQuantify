'use client';

import {
  AlertTriangle,
  Box,
  Download,
  FileText,
  Loader2,
  MoreVertical,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import Link from 'next/link';
import {
  useCallback, useRef, useState, type ChangeEvent, type DragEvent, type JSX,
} from 'react';

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
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
import { useDeleteProjectFile } from './useDeleteProjectFile';
import { useProjectFiles } from './useProjectFiles';
import { useRetryExtraction } from './useRetryExtraction';
import { useUploadProjectFile } from './useUploadProjectFile';

type Props = {
  projectId: string;
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

function isIfcFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.ifc');
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
  // failed
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

export function ProjectFiles({ projectId }: Props): JSX.Element {
  const filesQuery = useProjectFiles(projectId, 'all');
  const uploadMutation = useUploadProjectFile();
  const deleteMutation = useDeleteProjectFile();
  const retryMutation = useRetryExtraction();
  const { tokens } = useAuth();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const startUpload = useCallback((file: File): void => {
    if (!isIfcFile(file)) {
      const id = nextUploadId();
      setPending((prev) => [
        ...prev,
        {
          id,
          file,
          state: { kind: 'rejected', reason: 'FILE_NOT_ISO_10303_21' },
        },
      ]);
      return;
    }

    const id = nextUploadId();
    setPending((prev) => [...prev, { id, file, state: { kind: 'uploading' } }]);

    uploadMutation.mutate(
      { projectId, file },
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
  }, [projectId, uploadMutation]);

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

  const handleDownload = async (file: ProjectFile): Promise<void> => {
    if (tokens === null) return;
    try {
      const response = await getDownloadUrl(tokens.access_token, projectId, file.id);
      window.open(response.download_url, '_blank', 'noopener,noreferrer');
    } catch {
      // The list query already surfaces any auth issues. Keep this silent.
    }
  };

  const handleDeleteConfirm = (): void => {
    if (deleteTarget === null) return;
    deleteMutation.mutate(
      { projectId, fileId: deleteTarget.id },
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

  const files = filesQuery.data ?? [];
  const readyFiles = files.filter((f) => f.status === 'ready');
  const rejectedFiles = files.filter((f) => f.status === 'rejected');
  const fileError = filesQuery.error;

  return (
    <section className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => { setIsDragging(false); }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-background-secondary',
        )}
      >
        <UploadCloud className="h-8 w-8 text-foreground-tertiary" />
        <p className="text-body2 text-foreground">
          Drag &amp; drop IFC files here, or
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
          Choose files
        </Button>
        <p className="text-caption text-foreground-tertiary">
          .ifc files only
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".ifc"
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
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`file-skeleton-${String(i)}`} className="h-14 w-full" />
          ))}
        </div>
      ) : null}

      {fileError === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {fileError instanceof ApiError ? fileError.detail : 'Failed to load files.'}
        </div>
      )}

      {!filesQuery.isLoading && readyFiles.length === 0 && pending.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files yet"
          description="Upload an IFC model to get started."
          action={undefined}
          className={undefined}
        />
      ) : null}

      {readyFiles.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {readyFiles.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="h-5 w-5 text-foreground-secondary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body2 font-medium text-foreground">
                  {file.original_filename}
                </span>
                <span className="text-caption text-foreground-tertiary">
                  {formatFileSize(file.size_bytes)}
                  {' · '}
                  {formatSchemaLabel(file.ifc_schema)}
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
                    retryMutation.mutate({ projectId, fileId: file.id });
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              ) : null}
              {file.extraction_status === 'succeeded' ? (
                <Link
                  href={`/projects/${projectId}/viewer/${file.id}`}
                  aria-label={`View ${file.original_filename} in 3D`}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
                >
                  <Box className="h-4 w-4" />
                  View 3D
                </Link>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Download ${file.original_filename}`}
                onClick={() => { handleDownload(file).catch(() => undefined); }}
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
                      setDeleteTarget(file);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {rejectedFiles.length === 0 ? null : (
        <details className="rounded-lg border border-border bg-background px-4 py-3">
          <summary className="cursor-pointer text-body2 font-medium text-foreground-secondary">
            {rejectedFiles.length} rejected file{rejectedFiles.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {rejectedFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 text-caption text-foreground-tertiary"
              >
                <span className="truncate">{file.original_filename}</span>
                <span className="text-error">
                  {formatRejection(file.rejection_reason)}
                </span>
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
    </section>
  );
}
