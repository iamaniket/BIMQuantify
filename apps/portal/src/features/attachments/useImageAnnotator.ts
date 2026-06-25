'use client';

import {
  ANNOTATION_COLORS,
  AnnotationToolbar,
  ImageAnnotator,
  STROKE_PRESETS,
  useAnnotationHistory,
  type AnnotationToolbarLabels,
  type ToolbarTool,
} from '@bimdossier/annotation';
import { useTranslations } from 'next-intl';
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { getAttachment } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { readAnnotations, readSourceVersionId } from './annotationState';
import { attachmentsKey } from './queryKeys';
import { useAttachmentViewUrl } from './useAttachmentViewUrl';
import { useSaveAnnotatedPhoto } from './useSaveAnnotatedPhoto';

type UseImageAnnotatorArgs = {
  projectId: string;
  /** The attachment to annotate (its original version is burned from). */
  attachmentId: string | null;
  /** Only fetch + bind keyboard shortcuts while actively annotating. */
  enabled: boolean;
};

export type UseImageAnnotatorResult = {
  /** Attachment detail + original image URL both loaded. */
  ready: boolean;
  /** Detail or image-URL fetch failed. */
  failed: boolean;
  isLoading: boolean;
  /** Finished `<AnnotationToolbar/>` (labels baked in) — caller only adds the strip chrome. */
  toolbar: ReactNode;
  /** Finished `<ImageAnnotator/>` — caller only adds the dark surface chrome. */
  canvas: ReactNode;
  /** Footer hint (switches to the redaction warning once a blur is present). */
  hint: string;
  hasRedaction: boolean;
  /** Burn + upload the new version; `onSuccess` receives the new head attachment. */
  save: (onSuccess?: (next: Attachment) => void) => void;
  isSaving: boolean;
  canSave: boolean;
};

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

/**
 * The shared photo-annotation editor: data loading (attachment detail + the
 * original image's presigned URL), undo/redo state, tool/colour/stroke state,
 * keyboard shortcuts, and the burn-and-save mutation. Returns finished toolbar +
 * canvas nodes so both the standalone modal and the inline attachment viewer can
 * place them in their own chrome without duplicating the wiring.
 */
export function useImageAnnotator({
  projectId,
  attachmentId,
  enabled,
}: UseImageAnnotatorArgs): UseImageAnnotatorResult {
  const t = useTranslations('imageAnnotator');

  const attachmentQuery = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), attachmentId, 'detail'] as const,
    queryFn: (accessToken) => getAttachment(accessToken, projectId, attachmentId!),
    enabled: enabled && attachmentId !== null,
  });
  const attachment = attachmentQuery.data ?? null;
  const sourceVersionId = attachment !== null ? readSourceVersionId(attachment) : null;

  const originalUrlQuery = useAttachmentViewUrl(projectId, enabled ? sourceVersionId : null);
  const originalUrl = originalUrlQuery.data?.download_url;

  const ready = enabled && attachment !== null && originalUrl !== undefined;
  const failed = attachmentQuery.isError || originalUrlQuery.isError;

  const history = useAnnotationHistory([]);
  const [tool, setTool] = useState<ToolbarTool>('select');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_PRESETS.medium);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const annotations = history.value;
  const hasRedaction = useMemo(() => annotations.some((a) => a.tool === 'blur'), [annotations]);

  // Re-seed the editor whenever a different attachment loads, or on re-entry
  // (enabled false→true). Replaces the old `key={attachment.id}` remount: the
  // hook outlives a single attachment, so a stale-state guard is required.
  const lastResetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      lastResetRef.current = null;
      return;
    }
    if (attachment === null) return;
    if (lastResetRef.current === attachment.id) return;
    lastResetRef.current = attachment.id;
    history.reset(readAnnotations(attachment));
    setTool('select');
    setColor(ANNOTATION_COLORS[0]);
    setStrokeWidth(STROKE_PRESETS.medium);
    setSelectedId(null);
  }, [enabled, attachment, history]);

  const deleteSelected = useCallback(() => {
    if (selectedId === null) return;
    history.set((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, history]);

  // Keyboard shortcuts — only while annotating, and ignored while typing in the
  // text-tool input. Gated on `enabled` so the always-mounted viewer never eats
  // Ctrl+Z / Delete / Backspace when not annotating.
  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [enabled, history, selectedId, deleteSelected]);

  const saveMutation = useSaveAnnotatedPhoto(projectId);

  const save = useCallback(
    (onSuccess?: (next: Attachment) => void) => {
      if (attachment === null || originalUrl === undefined) return;
      saveMutation.mutate(
        {
          attachment,
          annotations,
          originalImageUrl: originalUrl,
          sourceVersionId: sourceVersionId ?? attachment.id,
        },
        {
          onSuccess: (next) => {
            toast.success(t('saved'));
            onSuccess?.(next);
          },
          onError: () => { toast.error(t('saveError')); },
        },
      );
    },
    [saveMutation, attachment, originalUrl, annotations, sourceVersionId, t],
  );

  const labels = buildLabels(t);

  const toolbar: ReactNode = createElement(AnnotationToolbar, {
    tool,
    onToolChange: (next: ToolbarTool) => { setTool(next); if (next !== 'select') setSelectedId(null); },
    color,
    onColorChange: setColor,
    strokeWidth,
    onStrokeWidthChange: setStrokeWidth,
    onUndo: history.undo,
    onRedo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    onDelete: deleteSelected,
    canDelete: selectedId !== null,
    onClear: () => { history.set([]); setSelectedId(null); },
    canClear: annotations.length > 0,
    labels,
  });

  const canvas: ReactNode = originalUrl === undefined
    ? null
    : createElement(ImageAnnotator, {
      imageUrl: originalUrl,
      value: annotations,
      onChange: history.set,
      tool,
      onToolChange: setTool,
      color,
      strokeWidth,
      selectedId,
      onSelectedIdChange: setSelectedId,
    });

  return {
    ready,
    failed,
    isLoading: enabled && !ready && !failed,
    toolbar,
    canvas,
    hint: hasRedaction ? t('redactWarning') : t('hint'),
    hasRedaction,
    save,
    isSaving: saveMutation.isPending,
    canSave: ready && annotations.length > 0 && !saveMutation.isPending,
  };
}
