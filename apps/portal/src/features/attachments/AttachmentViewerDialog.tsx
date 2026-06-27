'use client';

import { Camera, FileAudio, FileText, FileVideo, Image, Pencil } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimdossier/i18n';
import {
  useCallback,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { Button, Spinner } from '@bimdossier/ui';

import {
  DocumentViewerDialog,
  NoPreview,
  StageBadge,
  type MetaGroupSpec,
  type MetaRow,
} from '@/components/shared/DocumentViewerDialog';

import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import { isHttpUrl, openExternalUrl } from '@/lib/url';
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
import { useImageAnnotator } from './useImageAnnotator';

type Props = {
  attachment: Attachment | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new head attachment after an inline annotation is saved. */
  onReplaced?: (next: Attachment) => void;
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

// ─── Media stage ─────────────────────────────────────────────────────

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
  const noPreviewIcon = CATEGORY_ICONS[attachment.attachment_category ?? 'other'] ?? FileText;

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
    return <NoPreview filename={attachment.original_filename} label={t('viewerNoPreview')} icon={noPreviewIcon} />;
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

  if (attachment.content_type === 'application/pdf' && isHttpUrl(viewUrl)) {
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
      return <NoPreview filename={attachment.original_filename} label={t('viewerNoPreview')} icon={noPreviewIcon} />;
    }
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-background-secondary p-4 text-caption text-foreground">
        {textContent}
      </pre>
    );
  }

  return <NoPreview filename={attachment.original_filename} label={t('viewerNoPreview')} icon={noPreviewIcon} />;
}

// ─── Metadata rail bits ──────────────────────────────────────────────

function KindChip({ kind }: { kind: string }): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments.kindLabel');
  const Icon = CATEGORY_ICONS[kind] ?? FileText;
  const label = t.has(kind) ? t(kind) : t('other');
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
  onReplaced,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const tAnnotate = useTranslations('imageAnnotator');
  const locale = useLocale() as Locale;
  const { tokens } = useAuth();
  const [annotating, setAnnotating] = useState(false);

  // Always re-open in view mode (annotate state shouldn't survive a close).
  useEffect(() => {
    if (!open) setAnnotating(false);
  }, [open]);

  const editor = useImageAnnotator({
    projectId,
    attachmentId: attachment?.id ?? null,
    enabled: open && annotating,
  });

  const handleSaveInline = useCallback(() => {
    editor.save((next) => {
      setAnnotating(false);
      onReplaced?.(next);
    });
  }, [editor, onReplaced]);

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
      openExternalUrl(downloadUrl);
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, projectId, attachment, t]);

  if (attachment === null) {
    return (
      <DocumentViewerDialog
        open={false}
        onOpenChange={onOpenChange}
        title=""
        subtitle=""
        preview={null}
        metaGroups={[]}
        footerInfo=""
        closeLabel={t('viewerClose')}
      />
    );
  }

  const kind = fileKind(attachment);
  const isPdf = kind === 'pdf';
  const exif = extractExifMeta(attachment);
  const dims = formatDims(exif.dims);
  const camera = formatCamera(exif.camera);
  const mediaStage = attachment.attachment_category === 'image'
    || attachment.attachment_category === 'video';

  // ── File ──
  const fileRows: MetaRow[] = [
    { label: t('viewerFilename'), value: attachment.original_filename, mono: true },
    { label: t('viewerSize'), value: formatSize(attachment.size_bytes), mono: true },
    { label: t('viewerType'), value: attachment.content_type, mono: true },
    { label: t('viewerCategory'), value: <KindChip kind={kind} /> },
  ];

  // ── Media / Document (only fields we actually have) ──
  const mediaRows: MetaRow[] = [];
  if (dims !== null) {
    mediaRows.push({ label: t('viewerDimensions'), value: dims, mono: true });
  }
  if (camera !== null) {
    mediaRows.push({ label: t('viewerCamera'), value: camera });
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

  const originRows: MetaRow[] = [
    {
      label: t('viewerUploadedAt'),
      value: formatDateFull(attachment.created_at, locale),
      mono: true,
    },
    { label: t('viewerUploadedBy'), value: uploadedByNode },
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

  const metaGroups: MetaGroupSpec[] = [{ title: t('viewerGroupFile'), rows: fileRows }];
  if (mediaRows.length > 0) {
    metaGroups.push({
      title: isPdf ? t('viewerGroupDocument') : t('viewerGroupMedia'),
      rows: mediaRows,
    });
  }
  metaGroups.push({ title: t('viewerGroupOrigin'), rows: originRows });

  const annotatePreview = editor.ready ? (
    <div className="h-full w-full bg-[var(--viewer-canvas-bg)]">{editor.canvas}</div>
  ) : (
    <div className="flex h-full items-center justify-center">
      {editor.failed ? (
        <p className="text-body3 text-foreground-tertiary">{tAnnotate('loadError')}</p>
      ) : (
        <div className="flex flex-col items-center gap-2 text-foreground-tertiary">
          <Spinner className="text-primary" />
          <span className="text-body3">{tAnnotate('loading')}</span>
        </div>
      )}
    </div>
  );

  const annotateFooter = (
    <>
      <span className="min-w-0 truncate text-caption text-foreground-tertiary">
        {editor.hint}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="border"
          size="md"
          onClick={() => { setAnnotating(false); }}
          disabled={editor.isSaving}
        >
          {tAnnotate('cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleSaveInline}
          disabled={!editor.canSave}
        >
          {editor.isSaving ? tAnnotate('saving') : tAnnotate('save')}
        </Button>
      </div>
    </>
  );

  return (
    <DocumentViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={annotating ? tAnnotate('title') : t('viewerTitle')}
      subtitle={annotating ? tAnnotate('subtitle') : t('viewerSubtitle')}
      imageStage={annotating ? false : mediaStage}
      toolbar={annotating && editor.ready ? editor.toolbar : undefined}
      hideRail={annotating}
      preview={annotating ? annotatePreview : (
        <>
          <ContentPreview
            attachment={attachment}
            viewUrl={viewUrl}
            isLoading={viewUrlQuery.isLoading}
            t={t}
          />
          {attachment.attachment_category === 'image' && dims !== null && (
            <StageBadge>{dims}</StageBadge>
          )}
        </>
      )}
      description={attachment.description}
      metaGroups={metaGroups}
      footerInfo={`${formatDateFull(attachment.created_at, locale)} · ${uploadedByText}`}
      footerActions={attachment.attachment_category === 'image' ? (
        <Button
          type="button"
          variant="border"
          size="md"
          onClick={() => { setAnnotating(true); }}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {attachment.annotation_state !== null ? t('editAnnotations') : t('annotate')}
        </Button>
      ) : undefined}
      footer={annotating ? annotateFooter : undefined}
      onEscapeKeyDown={annotating
        ? (e) => { e.preventDefault(); setAnnotating(false); }
        : undefined}
      closeLabel={t('viewerClose')}
      downloadLabel={t('download')}
      onDownload={handleDownload}
    />
  );
}
