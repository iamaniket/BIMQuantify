'use client';

import { Camera, Download, FileAudio, FileText, FileVideo, Image, Info, LinkIcon } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';
import {
  useCallback,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
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
  Spinner,
} from '@bimstitch/ui';

import { Eyebrow } from '@/components/shared/Eyebrow';
import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import {
  extractExifMeta,
  formatCamera,
  formatCoord,
  formatDateFull,
  formatDims,
  formatSize,
} from './attachmentMeta';
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

/** Treat PDFs as their own kind even though they live under the `office` category. */
function fileKind(attachment: Attachment): string {
  if (attachment.content_type === 'application/pdf') return 'pdf';
  return attachment.attachment_category ?? 'other';
}

const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  office: 'Document',
  other: 'File',
};

// ─── Media stage — real preview wrapped in the dialog's stage chrome ──

function NoPreview({
  attachment,
  t,
}: {
  attachment: Attachment;
  t: ReturnType<typeof useTranslations>;
}): JSX.Element {
  const Icon = CATEGORY_ICONS[attachment.attachment_category ?? 'other'] ?? FileText;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
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
      attachment.content_type.startsWith('text/')
      || attachment.original_filename.endsWith('.txt')
    ) {
      fetch(viewUrl)
        .then((res) => res.text())
        .then(setTextContent)
        .catch(() => { setTextContent(null); });
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
      <div className="flex h-full items-center justify-center overflow-hidden p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
      <div className="flex h-full items-center justify-center p-2">
        <video controls className="max-h-full max-w-full" src={viewUrl}>
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (attachment.attachment_category === 'audio') {
    const Icon = CATEGORY_ICONS['audio'] ?? FileAudio;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
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
        src={`${viewUrl}#toolbar=0`}
        title={attachment.original_filename}
        className="h-full w-full border-0"
      />
    );
  }

  if (
    attachment.content_type.startsWith('text/')
    || attachment.original_filename.endsWith('.txt')
  ) {
    if (textContent === null) {
      return <NoPreview attachment={attachment} t={t} />;
    }
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-background-secondary p-4 text-caption text-foreground">
        {textContent}
      </pre>
    );
  }

  return <NoPreview attachment={attachment} t={t} />;
}

function StageBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="absolute bottom-3 left-3 rounded bg-black/55 px-2 py-1 font-sans text-[10.5px] tracking-wide text-white backdrop-blur-sm">
      {children}
    </div>
  );
}

// ─── Metadata rail bits ──────────────────────────────────────────────

type MetaValue = { label: string; value: ReactNode; mono: boolean };

function MetaGroup({
  title,
  rows,
}: {
  title: string;
  rows: MetaValue[];
}): JSX.Element {
  return (
    <div>
      <Eyebrow className="mb-2.5">
        {title}
      </Eyebrow>
      <div className="flex flex-col">
        {rows.map(({ label, value, mono }) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-border py-[7px] last:border-b-0"
          >
            <span className="shrink-0 whitespace-nowrap text-[12.5px] text-foreground-tertiary">
              {label}
            </span>
            <span
              className={`min-w-0 max-w-[62%] break-words text-right text-[12.5px] font-medium tabular-nums text-foreground ${
                mono ? 'font-sans' : ''
              }`}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KindChip({ kind }: { kind: string }): JSX.Element {
  const Icon = CATEGORY_ICONS[kind] ?? FileText;
  const label = KIND_LABEL[kind] ?? KIND_LABEL['other'];
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <Icon className="h-3.5 w-3.5 text-foreground-tertiary" />
      {label}
    </span>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────

export function AttachmentViewerDialog({
  attachment,
  projectId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const locale = useLocale() as Locale;
  const { tokens } = useAuth();

  const viewUrlQuery = useAttachmentViewUrl(
    projectId,
    open && attachment !== null ? attachment.id : null,
  );
  const viewUrl = viewUrlQuery.data !== undefined
    ? viewUrlQuery.data.download_url
    : undefined;

  const handleDownload = useCallback(async () => {
    if (tokens === null || attachment === null) return;
    try {
      const { download_url: downloadUrl } = await getAttachmentDownloadUrl(
        tokens.access_token,
        projectId,
        attachment.id,
      );
      window.open(downloadUrl, '_blank');
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, projectId, attachment, t]);

  if (attachment === null) {
    return (
      <Dialog open={false}>
        <DialogContent />
      </Dialog>
    );
  }

  const kind = fileKind(attachment);
  const isPdf = kind === 'pdf';
  const exif = extractExifMeta(attachment);
  const dims = formatDims(exif.dims);
  const camera = formatCamera(exif.camera);
  const darkStage = attachment.attachment_category === 'image'
    || attachment.attachment_category === 'video';

  // ── File ──
  const fileRows: MetaValue[] = [
    { label: t('viewerFilename'), value: attachment.original_filename, mono: true },
    { label: t('viewerSize'), value: formatSize(attachment.size_bytes), mono: true },
    { label: t('viewerType'), value: attachment.content_type, mono: true },
    { label: t('viewerCategory'), value: <KindChip kind={kind} />, mono: false },
  ];

  // ── Media / Document (only fields we actually have) ──
  const mediaRows: MetaValue[] = [];
  if (dims !== null) {
    mediaRows.push({ label: t('viewerDimensions'), value: dims, mono: true });
  }
  if (camera !== null) {
    mediaRows.push({ label: t('viewerCamera'), value: camera, mono: false });
  }
  if (exif.capturedAt !== null) {
    mediaRows.push({
      label: t('viewerCapturedAt'),
      value: formatDateFull(exif.capturedAt, locale),
      mono: true,
    });
  }
  if (exif.gps !== null) {
    mediaRows.push({
      label: t('viewerLocation'),
      value: formatCoord(exif.gps.latitude, exif.gps.longitude),
      mono: true,
    });
  }

  // ── Origin ──
  let uploadedByNode: ReactNode = '—';
  if (attachment.uploaded_by_name !== null) {
    uploadedByNode = attachment.uploaded_by_name;
  } else if (attachment.capture_link_id !== null) {
    uploadedByNode = (
      <span className="inline-flex items-center gap-1">
        <Camera className="h-3 w-3" />
        {t('viaCapture')}
      </span>
    );
  }

  const originRows: MetaValue[] = [
    {
      label: t('viewerUploadedAt'),
      value: formatDateFull(attachment.created_at, locale),
      mono: true,
    },
    { label: t('viewerUploadedBy'), value: uploadedByNode, mono: false },
  ];
  if (attachment.version_number > 1) {
    originRows.push({
      label: t('viewerVersion'),
      value: `v${String(attachment.version_number)}`,
      mono: true,
    });
  }

  const uploadedByText = attachment.uploaded_by_name
    ?? (attachment.capture_link_id !== null ? t('viaCapture') : '—');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[620px] max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] flex-col overflow-hidden p-0"
        style={{ maxWidth: 'calc(100vw - 48px)' }}
      >
        {/* Header */}
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
          <DialogTitle>{t('viewerTitle')}</DialogTitle>
          <DialogDescription>{t('viewerSubtitle')}</DialogDescription>
        </DialogHeader>

        {/* Body — media stage + metadata rail */}
        <DialogBody className="grid min-h-0 flex-1 grid-cols-[1fr_296px] gap-0 overflow-hidden p-0">
          <div className="min-h-0 p-5">
            <div
              className={`relative h-full w-full overflow-hidden rounded-lg ${
                darkStage ? 'bg-[#101316]' : 'bg-background-secondary'
              }`}
            >
              <ContentPreview
                attachment={attachment}
                viewUrl={viewUrl}
                isLoading={viewUrlQuery.isLoading}
                t={t}
              />
              {attachment.attachment_category === 'image' && dims !== null && (
                <StageBadge>{dims}</StageBadge>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface-low px-5 py-5">
            {attachment.description !== null && (
              <div className="text-body3 leading-snug text-foreground-secondary">
                {attachment.description}
              </div>
            )}
            <MetaGroup title={t('viewerGroupFile')} rows={fileRows} />
            {mediaRows.length > 0 && (
              <MetaGroup
                title={isPdf ? t('viewerGroupDocument') : t('viewerGroupMedia')}
                rows={mediaRows}
              />
            )}
            <MetaGroup title={t('viewerGroupOrigin')} rows={originRows} />
          </div>
        </DialogBody>

        {/* Footer — info · Close · Download */}
        <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2 text-foreground-tertiary">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-sans text-[11.5px]">
              {`${formatDateFull(attachment.created_at, locale)} · ${uploadedByText}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="border"
              size="md"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('viewerClose')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleDownload}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t('download')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
