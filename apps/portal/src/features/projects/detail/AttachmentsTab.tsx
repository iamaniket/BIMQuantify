'use client';

import { Camera, FileText, Upload } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  EmptyState,
  Select,
  SplitButton,
} from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';
import {
  buildCaptureMetadata,
  requestGeolocation,
  type GeolocationResult,
} from '@/lib/upload/captureMetadata';
import { AttachmentRow } from '@/features/viewer/shared/attachments/AttachmentRow';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { CaptureLinksList } from '@/features/attachments/CaptureLinksList';
import { CreateCaptureLinkDialog } from '@/features/attachments/CreateCaptureLinkDialog';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

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

  const allAttachments = flattenPages(attachmentsQuery.data);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        filter={(
          <Select
            selectSize="md"
            value={categoryFilter ?? 'all'}
            onChange={(e) => { setCategoryFilter(e.target.value === 'all' ? undefined : e.target.value as AttachmentCategoryValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            {CATEGORY_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={(
          <SplitButton
            label={t('uploadButton')}
            icon={<Upload className="h-3.5 w-3.5" />}
            disabled={uploadMutation.isPending}
            onClick={() => { fileInputRef.current?.click(); }}
            menuLabel={t('captureLink')}
            items={[
              {
                id: 'capture-link',
                label: t('captureLink'),
                icon: <Camera className="h-4 w-4" />,
                onSelect: () => { setShowCaptureLinks((prev) => !prev); },
              },
              {
                id: 'create-capture-link',
                label: t('captureLinkCreate'),
                icon: <Camera className="h-4 w-4" />,
                onSelect: () => {
                  setShowCaptureLinks(true);
                  setCaptureLinkDialogOpen(true);
                },
              },
            ]}
          />
        )}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.pptx,.txt"
        onChange={(e) => { void handleFileChange(e); }}
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      {/* Upload progress */}
      {uploadMutation.isPending && (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-foreground-secondary">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t('uploading')}
          </div>
        </div>
      )}

      <ResourceList
        isLoading={attachmentsQuery.isLoading}
        total={allAttachments.length}
        filteredCount={attachments.length}
        searchActive={searchQuery !== ''}
        noResultsLabel={t('noResults')}
        hasNextPage={attachmentsQuery.hasNextPage}
        isFetchingNextPage={attachmentsQuery.isFetchingNextPage}
        onLoadMore={() => { void attachmentsQuery.fetchNextPage(); }}
        empty={uploadMutation.isPending ? null : (
          <EmptyState
            icon={FileText}
            title={t('title')}
            description={t('description')}
            action={(
              <Button
                variant="primary"
                size="md"
                onClick={() => { fileInputRef.current?.click(); }}
              >
                {t('ctaLabel')}
              </Button>
            )}
            className={undefined}
          />
        )}
      >
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
      </ResourceList>

      {/* Capture links section */}
      {showCaptureLinks && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <div className="text-body3 font-semibold text-foreground">{t('captureLink')}</div>
            <Button
              variant="border"
              size="md"
              onClick={() => { setCaptureLinkDialogOpen(true); }}
            >
              {t('captureLinkCreate')}
            </Button>
          </div>
          <CaptureLinksList projectId={projectId} />
        </div>
      )}
      </div>

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
