'use client';

import {
  Camera,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  Image,
  LinkIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Spinner,
} from '@bimstitch/ui';

import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { useAttachmentViewUrl } from './useAttachmentViewUrl';

type Props = {
  attachment: Attachment | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

function ContentPreview({
  attachment,
  viewUrl,
  isLoading,
  t,
}: {
  attachment: Attachment;
  viewUrl: string | undefined;
  isLoading: boolean;
  t: ReturnType<typeof useTranslations>;
}): JSX.Element {
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (viewUrl === undefined) return;
    if (
      attachment.content_type.startsWith('text/') ||
      attachment.original_filename.endsWith('.txt')
    ) {
      void fetch(viewUrl)
        .then((res) => res.text())
        .then(setTextContent)
        .catch(() => setTextContent(null));
    }
  }, [viewUrl, attachment.content_type, attachment.original_filename]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-body3 text-foreground-tertiary">
          <Spinner className="mx-auto mb-2 text-primary" />
          {t('viewerLoadingPreview')}
        </div>
      </div>
    );
  }

  if (viewUrl === undefined) {
    return <NoPreview attachment={attachment} t={t} />;
  }

  if (attachment.attachment_category === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden">
        <img
          src={viewUrl}
          alt={attachment.original_filename}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (attachment.attachment_category === 'video') {
    return (
      <div className="flex h-full items-center justify-center">
        <video controls className="max-h-full max-w-full" src={viewUrl}>
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (attachment.attachment_category === 'audio') {
    const Icon = CATEGORY_ICONS['audio'] ?? FileAudio;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Icon className="h-12 w-12 text-foreground-tertiary" />
        <p className="text-body3 font-medium text-foreground">
          {attachment.original_filename}
        </p>
        <audio controls src={viewUrl} className="w-full max-w-md" />
      </div>
    );
  }

  if (attachment.content_type === 'application/pdf') {
    return (
      <iframe
        src={viewUrl}
        title={attachment.original_filename}
        className="h-full w-full border-0"
      />
    );
  }

  if (
    attachment.content_type.startsWith('text/') ||
    attachment.original_filename.endsWith('.txt')
  ) {
    if (textContent === null) {
      return <NoPreview attachment={attachment} t={t} />;
    }
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-background-secondary p-4 text-caption text-foreground">
        {textContent}
      </pre>
    );
  }

  return <NoPreview attachment={attachment} t={t} />;
}

function NoPreview({
  attachment,
  t,
}: {
  attachment: Attachment;
  t: ReturnType<typeof useTranslations>;
}): JSX.Element {
  const Icon = CATEGORY_ICONS[attachment.attachment_category] ?? FileText;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Icon className="h-12 w-12 text-foreground-tertiary" />
      <p className="text-body3 font-medium text-foreground">
        {attachment.original_filename}
      </p>
      <p className="text-caption text-foreground-tertiary">
        {t('viewerNoPreview')}
      </p>
    </div>
  );
}

function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-caption text-foreground-tertiary">{label}</dt>
      <dd className="text-right text-caption text-foreground">{children}</dd>
    </div>
  );
}

export function AttachmentViewerDialog({
  attachment,
  projectId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const { tokens } = useAuth();

  const viewUrlQuery = useAttachmentViewUrl(
    projectId,
    open && attachment !== null ? attachment.id : null,
  );
  const viewUrl = viewUrlQuery.data?.download_url;

  const handleDownload = useCallback(async () => {
    if (tokens === null || attachment === null) return;
    try {
      const { download_url } = await getAttachmentDownloadUrl(
        tokens.access_token,
        projectId,
        attachment.id,
      );
      window.open(download_url, '_blank');
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, projectId, attachment, t]);

  if (attachment === null) {
    return <Dialog open={false}><DialogContent /></Dialog>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('viewerTitle')}</DialogTitle>
          <DialogDescription>{t('viewerSubtitle')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 sm:flex-row">
          {/* Content preview */}
          <div className="min-h-[300px] flex-1 overflow-hidden rounded-md border border-border bg-background-secondary sm:min-h-[400px]">
            <ContentPreview
              attachment={attachment}
              viewUrl={viewUrl}
              isLoading={viewUrlQuery.isLoading}
              t={t}
            />
          </div>

          {/* Metadata sidebar */}
          <dl className="flex w-full shrink-0 flex-col gap-3 sm:w-56">
            <MetadataRow label={t('viewerFilename')}>
              <span className="break-all">{attachment.original_filename}</span>
            </MetadataRow>

            <MetadataRow label={t('viewerSize')}>
              {formatFileSize(attachment.size_bytes)}
            </MetadataRow>

            <MetadataRow label={t('viewerType')}>
              {attachment.content_type}
            </MetadataRow>

            <MetadataRow label={t('viewerCategory')}>
              <span className="inline-flex items-center gap-1 capitalize">
                {(() => {
                  const Icon = CATEGORY_ICONS[attachment.attachment_category] ?? FileText;
                  return <Icon className="h-3.5 w-3.5" />;
                })()}
                {attachment.attachment_category}
              </span>
            </MetadataRow>

            <MetadataRow label={t('viewerUploadedAt')}>
              {new Date(attachment.created_at).toLocaleString()}
            </MetadataRow>

            <MetadataRow label={t('viewerUploadedBy')}>
              {attachment.uploaded_by_name !== null
                ? attachment.uploaded_by_name
                : attachment.capture_link_id !== null
                  ? (
                    <span className="inline-flex items-center gap-1">
                      <Camera className="h-3 w-3" />
                      {t('viaCapture')}
                    </span>
                  )
                  : '—'}
            </MetadataRow>

            {attachment.description !== null && (
              <MetadataRow label={t('viewerDescription')}>
                {attachment.description}
              </MetadataRow>
            )}

            {attachment.linked_element_global_id !== null && (
              <MetadataRow label={t('viewerLinkedElement')}>
                <span className="inline-flex items-center gap-1">
                  <LinkIcon className="h-3 w-3" />
                  {attachment.linked_element_global_id}
                </span>
              </MetadataRow>
            )}

            {attachment.version_number > 1 && (
              <MetadataRow label={t('viewerVersion')}>
                {attachment.version_number}
              </MetadataRow>
            )}
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void handleDownload(); }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t('download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
