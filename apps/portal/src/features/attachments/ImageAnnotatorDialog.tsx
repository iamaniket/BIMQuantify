'use client';

import {
  ANNOTATION_COLORS,
  AnnotationToolbar,
  ImageAnnotator,
  STROKE_PRESETS,
  useAnnotationHistory,
  type Annotation2D,
  type AnnotationToolbarLabels,
  type ToolbarTool,
} from '@bimstitch/annotation';
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
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { getAttachment } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';
import { useAttachmentViewUrl } from './useAttachmentViewUrl';
import { useSaveAnnotatedPhoto } from './useSaveAnnotatedPhoto';

type Props = {
  projectId: string;
  attachmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new (annotated head) attachment id after a successful save. */
  onAnnotated?: (newAttachmentId: string) => void;
};

function readAnnotations(attachment: Attachment): Annotation2D[] {
  const state = attachment.annotation_state;
  if (state === null || typeof state !== 'object') return [];
  const list = (state as { annotations?: unknown }).annotations;
  return Array.isArray(list) ? (list as Annotation2D[]) : [];
}

function readSourceVersionId(attachment: Attachment): string {
  const state = attachment.annotation_state;
  if (state !== null && typeof state === 'object') {
    const src = (state as { sourceVersionId?: unknown }).sourceVersionId;
    if (typeof src === 'string' && src !== '') return src;
  }
  return attachment.id;
}

export function ImageAnnotatorDialog({
  projectId,
  attachmentId,
  open,
  onOpenChange,
  onAnnotated,
}: Props): JSX.Element {
  const t = useTranslations('imageAnnotator');

  const attachmentQuery = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), attachmentId, 'detail'] as const,
    queryFn: (accessToken) => getAttachment(accessToken, projectId, attachmentId!),
    enabled: open && attachmentId !== null,
  });
  const attachment = attachmentQuery.data ?? null;
  const sourceVersionId = attachment !== null ? readSourceVersionId(attachment) : null;

  const originalUrlQuery = useAttachmentViewUrl(projectId, open ? sourceVersionId : null);
  const originalUrl = originalUrlQuery.data?.download_url;

  const ready = attachment !== null && originalUrl !== undefined;
  const failed = attachmentQuery.isError || originalUrlQuery.isError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[680px] max-h-[calc(100vh-48px)] w-[960px] max-w-[calc(100vw-48px)] flex-col overflow-hidden p-0"
        style={{ maxWidth: 'calc(100vw - 48px)' }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <DialogBody className="flex min-h-0 flex-1 items-center justify-center">
            {failed ? (
              <p className="text-body3 text-foreground-tertiary">{t('loadError')}</p>
            ) : (
              <div className="flex flex-col items-center gap-2 text-foreground-tertiary">
                <Spinner className="text-primary" />
                <span className="text-body3">{t('loading')}</span>
              </div>
            )}
          </DialogBody>
        ) : (
          <AnnotatorBody
            key={attachment.id}
            projectId={projectId}
            attachment={attachment}
            originalImageUrl={originalUrl}
            sourceVersionId={sourceVersionId ?? attachment.id}
            initialAnnotations={readAnnotations(attachment)}
            labels={buildLabels(t)}
            t={t}
            onClose={() => { onOpenChange(false); }}
            onAnnotated={onAnnotated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildLabels(t: ReturnType<typeof useTranslations>): AnnotationToolbarLabels {
  return {
    select: t('tools.select'),
    rectangle: t('tools.rectangle'),
    ellipse: t('tools.ellipse'),
    line: t('tools.line'),
    arrow: t('tools.arrow'),
    cloud: t('tools.cloud'),
    freehand: t('tools.freehand'),
    text: t('tools.text'),
    blur: t('tools.blur'),
    color: t('color'),
    strokeWidth: t('strokeWidth'),
    thin: t('thin'),
    medium: t('medium'),
    thick: t('thick'),
    undo: t('undo'),
    redo: t('redo'),
    delete: t('delete'),
    clear: t('clear'),
  };
}

type BodyProps = {
  projectId: string;
  attachment: Attachment;
  originalImageUrl: string;
  sourceVersionId: string;
  initialAnnotations: Annotation2D[];
  labels: AnnotationToolbarLabels;
  t: ReturnType<typeof useTranslations>;
  onClose: () => void;
  onAnnotated: ((newAttachmentId: string) => void) | undefined;
};

function AnnotatorBody({
  projectId,
  attachment,
  originalImageUrl,
  sourceVersionId,
  initialAnnotations,
  labels,
  t,
  onClose,
  onAnnotated,
}: BodyProps): JSX.Element {
  const history = useAnnotationHistory(initialAnnotations);
  const [tool, setTool] = useState<ToolbarTool>('select');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_PRESETS.medium);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const saveMutation = useSaveAnnotatedPhoto(projectId);

  const annotations = history.value;
  const hasRedaction = useMemo(() => annotations.some((a) => a.tool === 'blur'), [annotations]);

  const deleteSelected = useCallback(() => {
    if (selectedId === null) return;
    history.set((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, history]);

  // Keyboard shortcuts — ignored while typing in the text-tool input.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId !== null) { e.preventDefault(); deleteSelected(); }
      } else if (e.key === 'Escape') {
        if (selectedId !== null) setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [history, selectedId, deleteSelected]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(
      { attachment, annotations, originalImageUrl, sourceVersionId },
      {
        onSuccess: (next) => {
          toast.success(t('saved'));
          onAnnotated?.(next.id);
          onClose();
        },
        onError: () => { toast.error(t('saveError')); },
      },
    );
  }, [saveMutation, attachment, annotations, originalImageUrl, sourceVersionId, onAnnotated, onClose, t]);

  return (
    <>
      <div className="shrink-0 border-b border-border px-4 py-2">
        <AnnotationToolbar
          tool={tool}
          onToolChange={(next) => { setTool(next); if (next !== 'select') setSelectedId(null); }}
          color={color}
          onColorChange={setColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          onUndo={history.undo}
          onRedo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onDelete={deleteSelected}
          canDelete={selectedId !== null}
          onClear={() => { history.set([]); setSelectedId(null); }}
          canClear={annotations.length > 0}
          labels={labels}
        />
      </div>

      <DialogBody className="min-h-0 flex-1 overflow-hidden bg-[#101316] p-3">
        <ImageAnnotator
          imageUrl={originalImageUrl}
          value={annotations}
          onChange={history.set}
          tool={tool}
          onToolChange={setTool}
          color={color}
          strokeWidth={strokeWidth}
          selectedId={selectedId}
          onSelectedIdChange={setSelectedId}
        />
      </DialogBody>

      <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
        <span className="min-w-0 truncate text-caption text-foreground-tertiary">
          {hasRedaction ? t('redactWarning') : t('hint')}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="border" size="md" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={saveMutation.isPending || annotations.length === 0}
          >
            {saveMutation.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
