'use client';

import {
  Camera,
  FileText,
  Search,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  EmptyState,
  Select,
  Skeleton,
} from '@bimstitch/ui';

import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';
import {
  buildCaptureMetadata,
  requestGeolocation,
  type GeolocationResult,
} from '@/lib/upload/captureMetadata';
import { AttachmentRow } from '@/features/viewer/attachments/AttachmentRow';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { CaptureLinksList } from '@/features/attachments/CaptureLinksList';
import { CreateCaptureLinkDialog } from '@/features/attachments/CreateCaptureLinkDialog';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';

type Props = {
  projectId: string;
};

const CATEGORY_FILTERS: Array<{ value: AttachmentCategoryValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'image', labelKey: 'filterImage' },
  { value: 'video', labelKey: 'filterVideo' },
  { value: 'audio', labelKey: 'filterAudio' },
  { value: 'office', labelKey: 'filterOffice' },
];

export function AttachmentsTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const [categoryFilter, setCategoryFilter] = useState<AttachmentCategoryValue | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [captureLinkDialogOpen, setCaptureLinkDialogOpen] = useState(false);
  const [showCaptureLinks, setShowCaptureLinks] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<GeolocationResult>({ status: 'unavailable' });

  useEffect(() => {
    void requestGeolocation().then((result) => { geoRef.current = result; });
  }, []);

  const attachmentsQuery = useAttachments(projectId, categoryFilter);
  const uploadMutation = useUploadAttachment(projectId);
  const deleteMutation = useDeleteAttachment(projectId);

  const allAttachments = attachmentsQuery.data ?? [];
  const attachments = searchQuery === ''
    ? allAttachments
    : allAttachments.filter((a) => a.original_filename.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file !== undefined) {
          void buildCaptureMetadata(file, 'file_picker', geoRef.current).then(
            (metadata) => {
              uploadMutation.mutate(
                { file, capture_metadata: metadata as unknown as Record<string, unknown> },
                { onSuccess: () => { toast.success(t('uploadSuccess', { name: file.name })); } },
              );
            },
          );
        }
      }
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
    },
    [uploadMutation, t],
  );

  const handleDelete = useCallback(
    (attachment: Attachment) => {
      deleteMutation.mutate(attachment.id, {
        onSuccess: () => { toast.success(t('deleteSuccess', { name: attachment.original_filename })); },
      });
    },
    [deleteMutation, t],
  );

  if (attachmentsQuery.isLoading) {
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
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            placeholder={t('searchPlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-body3 text-foreground placeholder:text-foreground-disabled focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Select
          selectSize="sm"
          value={categoryFilter ?? 'all'}
          onChange={(e) => { setCategoryFilter(e.target.value === 'all' ? undefined : e.target.value as AttachmentCategoryValue); }}
          className="w-auto shrink-0"
        >
          {CATEGORY_FILTERS.map(({ value, labelKey }) => (
            <option key={value} value={value}>{t(labelKey)}</option>
          ))}
        </Select>
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
      {attachments.length === 0 && !uploadMutation.isPending && (
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

      {/* Attachment list */}
      {attachments.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              projectId={projectId}
              expanded={expandedId === attachment.id}
              onToggle={() => { setExpandedId(expandedId === attachment.id ? null : attachment.id); }}
              onView={() => { setViewingAttachment(attachment); }}
              onDelete={() => { handleDelete(attachment); }}
            />
          ))}
        </div>
      )}

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

      <AttachmentViewerDialog
        attachment={viewingAttachment}
        projectId={projectId}
        open={viewingAttachment !== null}
        onOpenChange={(open) => { if (!open) setViewingAttachment(null); }}
      />
    </div>
  );
}
