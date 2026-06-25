'use client';

import {
  Blueprint, Box, Eye, RotateCcw, ShieldCheck, Upload, Trash2,
} from '@bimdossier/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback, useRef, useState, type ChangeEvent, type JSX,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  Badge, Checkbox, ConfirmDialog, CountChip, Eyebrow,

  DetailCard,
  DetailCardBody,
  DetailCardRow,
} from '@bimdossier/ui';

import { FileDropZone } from '@/components/shared/FileDropZone';
import { VersionTimeline } from '@/components/shared/resource';
import { ApiError } from '@/lib/api/client';
import type { FileTypeValue, Document, ProjectFile } from '@/lib/api/schemas';
import { useCheckCompliance } from '@/features/compliance/hooks';
import { useDeleteDocument } from '@/features/documents/useDeleteDocument';
import { DisciplineAssignSelect } from '@/features/documents/DisciplineAssignSelect';
import { useProjectPermissions } from '@/features/permissions';
import { acceptedExtensions, isAllowedFile } from '@/features/documents/fileValidation';
import { isFileViewable } from '@/features/documents/documentViewability';
import { useDocumentFiles } from '@/features/documents/useDocumentFiles';
import { useRestoreDocumentFileVersion } from '@/features/documents/useRestoreDocumentFileVersion';
import { useUploadDocumentFile } from '@/features/documents/useUploadDocumentFile';
import { UploadProgressItem, type UploadState } from '@/features/documents/UploadProgressItem';
import { viewerKeys } from '@/features/viewer/shared/queryKeys';
import { setViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { getViewerBundle } from '@/lib/api/projectFiles';
import { disciplineChipColors } from '@/lib/formatting/disciplineColors';
import { formatFileSize } from '@/lib/formatting/files';
import { useAuth } from '@/providers/AuthProvider';

import { RowActionPill } from '@/components/shared/resource/RowActionPill';

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
    <Badge variant={PILL_VARIANT[fileType]} size="md" bordered={false} className="shrink-0 uppercase">
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
  document: Document;
  prefetchedFiles: ProjectFile[] | undefined;
  isOpen: boolean;
  onToggle: () => void;
  /** Whether this document is currently checked for a bulk action. */
  selected?: boolean;
  onSelectToggle?: () => void;
  /** Level-assignment control rendered in the expanded action bar (2D documents). */
  levelControl?: JSX.Element | undefined;
};

export function DocumentsTableRow({
  projectId,
  document,
  prefetchedFiles,
  isOpen,
  onToggle,
  selected = false,
  onSelectToggle,
  levelControl,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.row');
  const tFiles = useTranslations('projectDetail.tabs.documents.files');
  const filesQuery = useDocumentFiles(projectId, document.id);
  const complianceMutation = useCheckCompliance(projectId, document.id);
  const uploadMutation = useUploadDocumentFile();
  const deleteMutation = useDeleteDocument();
  const restoreMutation = useRestoreDocumentFileVersion();
  const queryClient = useQueryClient();
  const { tokens } = useAuth();
  const { can } = useProjectPermissions(projectId);
  const canRemove = can('document', 'delete');
  const canEdit = can('document', 'update');
  const canRestore = can('project_file', 'update');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<{ fileId: string; version: number } | null>(null);
  const files = prefetchedFiles ?? filesQuery.data ?? [];
  const colors = disciplineChipColors(document.discipline);
  // 2D drawings (PDF/DXF/DWG) get the blueprint glyph; everything else (IFC or
  // not-yet-typed) is a 3D model. Matches the grouping in DocumentsTab so the row
  // glyph never contradicts its section header.
  const isDrawing = (
    document.primary_file_type === 'pdf'
    || document.primary_file_type === 'dxf'
    || document.primary_file_type === 'dwg'
  );
  const kindLabel = isDrawing ? t('kindDrawing') : t('kindModel');
  // The head is the model's restore pointer when set, else the newest version.
  const latestFile = (
    document.head_file_id != null ? files.find((f) => f.id === document.head_file_id) : undefined
  ) ?? (files.length > 0 ? files[0] : undefined);
  const isViewable = latestFile !== undefined && isFileViewable(latestFile);
  const canCheckBbl = latestFile?.file_type === 'ifc' && latestFile.extraction_status === 'succeeded';
  const lockedFileType: FileTypeValue | null = document.primary_file_type ?? null;

  // Clean URL — the loaded file is carried in the selection store, not the URL.
  const viewHref = `/projects/${projectId}/viewer`;
  const selectThisModel = useCallback(() => {
    if (latestFile === undefined) return;
    setViewerTarget(projectId, {
      kind: 'single',
      modelId: document.id,
      fileId: latestFile.id,
    });
  }, [projectId, document.id, latestFile]);

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
        documentId: document.id,
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
  }, [projectId, document.id, uploadMutation, lockedFileType, tFiles]);

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

  const handleRemove = useCallback(() => {
    deleteMutation.mutate(
      { projectId, documentId: document.id },
      { onSuccess: () => { setConfirmRemove(false); } },
    );
  }, [deleteMutation, projectId, document.id]);

  const handleRestore = useCallback(() => {
    if (confirmRestore === null) return;
    restoreMutation.mutate(
      { projectId, documentId: document.id, fileId: confirmRestore.fileId },
      { onSuccess: () => { setConfirmRestore(null); } },
    );
  }, [restoreMutation, projectId, document.id, confirmRestore]);

  const prewarmViewer = useCallback(() => {
    if (!isViewable || latestFile === undefined || tokens === null) return;
    const accessToken = tokens.access_token;
    const fileId = latestFile.id;
    queryClient
      .prefetchQuery({
        queryKey: viewerKeys.bundle(projectId, document.id, fileId),
        queryFn: () => getViewerBundle(accessToken, projectId, document.id, fileId),
        staleTime: 60_000,
      })
      .catch(() => undefined);
    import('@bimdossier/viewer').catch(() => undefined);
  }, [isViewable, latestFile, tokens, queryClient, projectId, document.id]);

  // Hover quick-actions (collapsed) and the expanded action bar share this set.
  const viewPill = (size: 'sm' | 'md'): JSX.Element | null => (
    isViewable && latestFile !== undefined ? (
      <RowActionPill
        size={size}
        href={viewHref}
        icon={<Eye className="h-3.5 w-3.5" />}
        label={t('view')}
        title={t('viewFile')}
        onClick={selectThisModel}
        onMouseEnter={prewarmViewer}
        onFocus={prewarmViewer}
      />
    ) : null
  );
  const uploadPill = (size: 'sm' | 'md'): JSX.Element => (
    <RowActionPill
      size={size}
      icon={<Upload className="h-3.5 w-3.5" />}
      label={t('upload')}
      title={t('uploadFile')}
      onClick={() => { inputRef.current?.click(); }}
    />
  );
  const checkBblPill = (size: 'sm' | 'md'): JSX.Element | null => (
    canCheckBbl && latestFile !== undefined ? (
      <RowActionPill
        size={size}
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        label={t('checkBbl')}
        pending={complianceMutation.isPending}
        onClick={() => { complianceMutation.mutate({ fileId: latestFile.id }); }}
      />
    ) : null
  );

  return (
    <>
      <DetailCard expanded={isOpen} onToggle={onToggle} accent="primary" selected={selected}>
        <DetailCardRow
          media={
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selected}
                onChange={() => { onSelectToggle?.(); }}
                onClick={(e) => { e.stopPropagation(); }}
                aria-label={t('selectAria', { name: document.name })}
              />
              <span
                className="flex h-6 w-9 shrink-0 items-center justify-center rounded-md"
                style={{ background: colors.bg, color: colors.fg }}
                title={kindLabel}
                aria-label={kindLabel}
              >
                {isDrawing
                  ? <Blueprint className="h-4 w-4" aria-hidden />
                  : <Box className="h-4 w-4" aria-hidden />}
              </span>
            </div>
          }
          info={
            files.length > 0 ? (
              <CountChip className="rounded-full bg-surface-high px-2 py-0.5 font-semibold">
                {t('verCount', { count: files.length })}
              </CountChip>
            ) : undefined
          }
          actions={
            <>
              {viewPill('md')}
              {uploadPill('md')}
              {checkBblPill('md')}
            </>
          }
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-body3 font-semibold leading-tight text-foreground">
              {document.name}
            </span>
            {latestFile !== undefined && (
              latestFile.file_type === 'ifc' ? (
                <span className="shrink-0 rounded-sm bg-primary-light px-1.5 py-0.5 font-sans text-micro font-semibold uppercase tabular-nums text-primary">
                  {latestFile.ifc_schema ?? 'IFC'}
                </span>
              ) : (
                <FileTypePill fileType={latestFile.file_type} schema={latestFile.ifc_schema} />
              )
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
            {latestFile !== undefined ? (
              <>
                <span className="truncate">{latestFile.original_filename}</span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{formatFileSize(latestFile.size_bytes)}</span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{formatRelativeTime(latestFile.updated_at, t)}</span>
              </>
            ) : (
              <span>{t('noFiles')}</span>
            )}
          </div>
        </DetailCardRow>

        {/* Always mounted so the collapsed-hover and expanded Upload pills can
            trigger it even though the action slots unmount. */}
        <input
          ref={inputRef}
          type="file"
          accept={acceptedExtensions(lockedFileType).join(',')}
          multiple
          className="hidden"
          onChange={handleInputChange}
        />

        <DetailCardBody>
          {/* Action bar — moved to the top of the expanded panel. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {viewPill('md')}
              {uploadPill('md')}
              {checkBblPill('md')}
              {canEdit && (
                <DisciplineAssignSelect
                  projectId={projectId}
                  documentId={document.id}
                  discipline={document.discipline}
                />
              )}
              {levelControl}
            </div>
            {canRemove && (
              <RowActionPill
                tone="danger"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t('remove')}
                onClick={() => { setConfirmRemove(true); }}
              />
            )}
          </div>

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

          {files.length > 0 && (
            <>
              <Eyebrow as="div" tone="tertiary" className="mb-2 mt-1 text-primary text-[7px]">
                {t('versionHistory', { count: files.length })}
              </Eyebrow>
              <VersionTimeline
                versions={files.map((f) => ({
                  id: f.id,
                  versionNumber: f.version_number,
                  filename: f.original_filename,
                  sizeBytes: f.size_bytes,
                  createdAt: f.created_at,
                }))}
                headId={latestFile?.id}
                isLoading={prefetchedFiles === undefined && filesQuery.isLoading}
                renderActions={
                  canRestore
                    ? (entry, isHead) => {
                        if (isHead) return null;
                        const f = files.find((ff) => ff.id === entry.id);
                        const viewable = f !== undefined && (
                          f.file_type === 'pdf'
                            ? f.status === 'ready'
                            : f.extraction_status === 'succeeded'
                        );
                        if (!viewable) return null;
                        return (
                          <RowActionPill
                            size="sm"
                            icon={<RotateCcw className="h-3.5 w-3.5" />}
                            label={t('restore')}
                            title={t('restoreTitle')}
                            pending={restoreMutation.isPending && confirmRestore?.fileId === entry.id}
                            onClick={() => { setConfirmRestore({ fileId: entry.id, version: entry.versionNumber }); }}
                          />
                        );
                      }
                    : undefined
                }
              />
            </>
          )}
        </DetailCardBody>
      </DetailCard>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(open) => { if (!open) setConfirmRemove(false); }}
        title={t('removeTitle')}
        description={t('removeBody', { name: document.name })}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={handleRemove}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={deleteMutation.error instanceof ApiError ? deleteMutation.error.detail : null}
      />

      <ConfirmDialog
        open={confirmRestore !== null}
        onOpenChange={(open) => { if (!open) setConfirmRestore(null); }}
        title={t('restoreTitle')}
        description={confirmRestore !== null ? t('restoreBody', { version: confirmRestore.version }) : ''}
        confirmLabel={t('restoreConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={handleRestore}
        variant="default"
        isPending={restoreMutation.isPending}
        errorMessage={restoreMutation.error instanceof ApiError ? restoreMutation.error.detail : null}
      />
    </>
  );
}
