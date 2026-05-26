'use client';

import {
  Camera,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  Image,
  LinkIcon,
  MoreHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
} from '@bimstitch/ui';

import { getDocumentDownloadUrl } from '@/lib/api/documents';
import type { Document, DocumentCategoryValue } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { CaptureLinksList } from '@/features/documents/CaptureLinksList';
import { CreateCaptureLinkDialog } from '@/features/documents/CreateCaptureLinkDialog';
import { useDeleteDocument } from '@/features/documents/useDeleteDocument';
import { useDocuments } from '@/features/documents/useDocuments';
import { useUploadDocument } from '@/features/documents/useUploadDocument';

type Props = {
  projectId: string;
};

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

const CATEGORY_FILTERS: Array<{ value: DocumentCategoryValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'image', labelKey: 'filterImage' },
  { value: 'video', labelKey: 'filterVideo' },
  { value: 'audio', labelKey: 'filterAudio' },
  { value: 'office', labelKey: 'filterOffice' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function DocumentenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documenten');
  const { tokens } = useAuth();
  const [categoryFilter, setCategoryFilter] = useState<DocumentCategoryValue | undefined>(undefined);
  const [captureLinkDialogOpen, setCaptureLinkDialogOpen] = useState(false);
  const [showCaptureLinks, setShowCaptureLinks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const documentsQuery = useDocuments(projectId, categoryFilter);
  const uploadMutation = useUploadDocument(projectId);
  const deleteMutation = useDeleteDocument(projectId);

  const documents = documentsQuery.data ?? [];

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file !== undefined) {
          uploadMutation.mutate({ file }, {
            onSuccess: () => { toast.success(t('uploadSuccess', { name: file.name })); },
          });
        }
      }
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
    },
    [uploadMutation, t],
  );

  const handleDownload = useCallback(
    async (doc: Document) => {
      if (tokens === null) return;
      try {
        const { download_url } = await getDocumentDownloadUrl(
          tokens.access_token,
          projectId,
          doc.id,
        );
        window.open(download_url, '_blank');
      } catch {
        toast.error(t('downloadError'));
      }
    },
    [tokens, projectId, t],
  );

  const handleDelete = useCallback(
    (doc: Document) => {
      deleteMutation.mutate(doc.id, {
        onSuccess: () => { toast.success(t('deleteSuccess', { name: doc.original_filename })); },
      });
    },
    [deleteMutation, t],
  );

  if (documentsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {CATEGORY_FILTERS.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => { setCategoryFilter(value === 'all' ? undefined : value); }}
              className={`rounded-md px-2.5 py-1 text-caption font-medium transition-colors ${
                (value === 'all' && categoryFilter === undefined) || value === categoryFilter
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background-secondary text-foreground-secondary hover:bg-background-tertiary'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="border"
            size="sm"
            onClick={() => { setShowCaptureLinks(!showCaptureLinks); }}
          >
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            {t('captureLink')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { fileInputRef.current?.click(); }}
            disabled={uploadMutation.isPending}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t('uploadButton')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.pptx,.txt"
          onChange={(e) => { void handleFileChange(e); }}
        />
      </div>

      {/* Upload progress */}
      {uploadMutation.isPending && (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-foreground-secondary">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t('uploading')}
          </div>
        </div>
      )}

      {/* Empty state */}
      {documents.length === 0 && !uploadMutation.isPending && (
        <EmptyState
          icon={FileText}
          title={t('title')}
          description={t('description')}
          action={(
            <Button
              variant="border"
              size="sm"
              onClick={() => { fileInputRef.current?.click(); }}
            >
              {t('ctaLabel')}
            </Button>
          )}
          className={undefined}
        />
      )}

      {/* Document list */}
      {documents.map((doc) => {
        const Icon = CATEGORY_ICONS[doc.document_category] ?? FileText;
        return (
          <div
            key={doc.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-background-secondary"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background-secondary">
              <Icon className="h-4.5 w-4.5 text-foreground-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body3 font-medium text-foreground">
                {doc.original_filename}
              </div>
              <div className="flex items-center gap-2 text-caption text-foreground-tertiary">
                <span>{formatFileSize(doc.size_bytes)}</span>
                <span className="opacity-40">&middot;</span>
                <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                {doc.capture_link_id !== null && (
                  <>
                    <span className="opacity-40">&middot;</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Camera className="h-3 w-3" />
                      {t('viaCapture')}
                    </span>
                  </>
                )}
                {doc.linked_element_global_id !== null && (
                  <>
                    <span className="opacity-40">&middot;</span>
                    <span className="inline-flex items-center gap-0.5">
                      <LinkIcon className="h-3 w-3" />
                      {t('linked')}
                    </span>
                  </>
                )}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-foreground-tertiary hover:bg-background-tertiary hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { void handleDownload(doc); }}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('download')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { handleDelete(doc); }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      {/* Capture links section */}
      {showCaptureLinks && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <div className="text-body3 font-semibold text-foreground">{t('captureLink')}</div>
            <Button
              variant="border"
              size="sm"
              onClick={() => { setCaptureLinkDialogOpen(true); }}
            >
              {t('captureLinkCreate')}
            </Button>
          </div>
          <CaptureLinksList projectId={projectId} />
        </div>
      )}

      <CreateCaptureLinkDialog
        projectId={projectId}
        open={captureLinkDialogOpen}
        onOpenChange={setCaptureLinkDialogOpen}
      />
    </div>
  );
}
