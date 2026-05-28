'use client';

import {
  Camera,
  FileAudio,
  FileText,
  FileVideo,
  Image,
  Loader2,
  MapPin,
  MousePointerClick,
  Paperclip,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { toast } from 'sonner';

import { Button, Input } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/PanelTabs';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import {
  useAttachments,
  useElementAttachments,
  usePdfPageAttachments,
  useProjectAttachments,
} from '@/features/attachments/useAttachments';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { useAttachmentViewUrl } from '@/features/attachments/useAttachmentViewUrl';
import type { Attachment } from '@/lib/api/schemas';
import type { ModelMetadata, ElementEntry } from '@/lib/api/viewerTypes';
import {
  useViewerEntityStore,
  parseEntityKey,
} from '@/stores/viewerEntityStore';

type AttachmentsPanelProps = {
  metadata: ModelMetadata | undefined;
  projectId: string;
  modelId: string;
  fileId: string;
  isPdf?: boolean;
  pdfCurrentPage?: number | null;
  pdfPinMode?: boolean;
  onPdfPinModeChange?: (enabled: boolean) => void;
};

type Scope = 'all' | 'entity' | 'project' | 'page';

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AttachmentThumbnail({
  attachment,
  projectId,
}: {
  attachment: Attachment;
  projectId: string;
}): JSX.Element {
  const viewUrlQuery = useAttachmentViewUrl(
    projectId,
    attachment.attachment_category === 'image' ? attachment.id : null,
  );
  const Icon = CATEGORY_ICONS[attachment.attachment_category] ?? FileText;

  if (attachment.attachment_category === 'image' && viewUrlQuery.data?.download_url) {
    return (
      <img
        src={viewUrlQuery.data.download_url}
        alt={attachment.original_filename}
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-background-secondary">
      <Icon className="h-5 w-5 text-foreground-tertiary" />
    </div>
  );
}

function AttachmentCard({
  attachment,
  projectId,
  onView,
  onDelete,
}: {
  attachment: Attachment;
  projectId: string;
  onView: () => void;
  onDelete: () => void;
}): JSX.Element {
  const t = useTranslations('viewerAttachments');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => { if (e.key === 'Enter') onView(); }}
      className="group flex cursor-pointer gap-2.5 rounded-md border border-border bg-background p-2 transition-colors hover:bg-background-secondary"
    >
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded">
        <AttachmentThumbnail attachment={attachment} projectId={projectId} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body3 font-medium text-foreground">
          {attachment.original_filename}
        </p>
        <p className="text-caption text-foreground-tertiary">
          {formatSize(attachment.size_bytes)} · {formatDate(attachment.created_at)}
          {attachment.uploaded_by_name !== null
            ? ` · ${attachment.uploaded_by_name}`
            : attachment.capture_link_id !== null
              ? ` · ${t('viaCapture')}`
              : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 self-center rounded p-1 text-foreground-tertiary opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
        title={t('deleteConfirm')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const PENDING_PIN_KEY = 'bimstitch.pendingPdfPin';

export function AttachmentsPanel({
  metadata,
  projectId,
  modelId,
  fileId,
  isPdf,
  pdfCurrentPage,
  pdfPinMode,
  onPdfPinModeChange,
}: AttachmentsPanelProps): JSX.Element {
  const t = useTranslations('viewerAttachments');
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const partialCount = selected.size;
  const hasSelection = selectedAll || partialCount > 0;

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  const selectedElement = useMemo((): ElementEntry | null => {
    if (selectedAll || selected.size !== 1) return null;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return null;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return null;
    return elementsByExpressId.get(parsed.localId) ?? null;
  }, [selected, selectedAll, elementsByExpressId]);

  const globalId = selectedElement?.globalId ?? null;

  const [scope, setScope] = useState<Scope>(isPdf ? 'all' : hasSelection ? 'entity' : 'all');
  const [query, setQuery] = useState('');
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinUploadRef = useRef(false);

  const allQuery = useAttachments(projectId);
  const entityQuery = useElementAttachments(projectId, fileId, globalId);
  const projectQuery = useProjectAttachments(projectId);
  const pageQuery = usePdfPageAttachments(
    projectId,
    fileId,
    isPdf ? (pdfCurrentPage ?? null) : null,
  );

  const uploadMutation = useUploadAttachment(projectId);
  const deleteMutation = useDeleteAttachment(projectId);

  const allItems = allQuery.data ?? [];
  const entityItems = entityQuery.data ?? [];
  const projectItems = projectQuery.data ?? [];
  const pageItems = pageQuery.data ?? [];

  const filteredItems = useMemo(() => {
    const items = scope === 'entity' ? entityItems : scope === 'project' ? projectItems : scope === 'page' ? pageItems : allItems;
    if (query.trim() === '') return items;
    const q = query.toLowerCase();
    return items.filter(
      (a) =>
        a.original_filename.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q),
    );
  }, [scope, entityItems, projectItems, pageItems, allItems, query]);

  const tabs: TabDef<Scope>[] = isPdf
    ? [
        { id: 'all', label: t('tabAll'), count: allItems.length },
        { id: 'page', label: t('tabOnPage'), count: pageItems.length },
        { id: 'project', label: t('tabProject'), count: projectItems.length },
      ]
    : [
        { id: 'all', label: t('tabAll'), count: allItems.length },
        { id: 'entity', label: t('tabOnEntity'), count: entityItems.length, disabled: !hasSelection },
        { id: 'project', label: t('tabProject'), count: projectItems.length },
      ];

  // Handle pending PDF pin from sessionStorage (set by PdfAnnotationLayer click)
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_PIN_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(PENDING_PIN_KEY);
    try {
      const pinData = JSON.parse(raw) as { type: string; page: number; x: number; y: number };
      if (pinData.type !== 'pdf') return;
      // Open file picker — once a file is selected, upload with linked_point
      const input = fileInputRef.current;
      if (!input) return;
      pinUploadRef.current = true;
      const handler = () => {
        pinUploadRef.current = false;
        const files = input.files;
        if (!files || files.length === 0) return;
        const file = files[0]!;
        uploadMutation.mutate(
          {
            file,
            linked_file_id: fileId,
            linked_model_id: modelId,
            linked_point: pinData,
            onProgress: (event) => {
              if (event.phase === 'hashing') setUploadPhase(t('uploadHashing'));
              else if (event.phase === 'uploading') setUploadPhase(t('uploadUploading'));
              else if (event.phase === 'completing') setUploadPhase(t('uploadCompleting'));
            },
          },
          {
            onSuccess: () => {
              setUploadPhase(null);
              toast.success(t('pinSuccess'));
              setScope('page');
            },
            onError: () => {
              setUploadPhase(null);
              toast.error(t('uploadError'));
            },
          },
        );
        input.removeEventListener('change', handler);
      };
      input.addEventListener('change', handler);
      input.click();
    } catch {
      // invalid JSON — ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = useCallback(
    (files: FileList | null) => {
      if (pinUploadRef.current) return;
      if (!files || files.length === 0) return;
      const file = files[0]!;
      uploadMutation.mutate(
        {
          file,
          linked_element_global_id: scope === 'entity' ? globalId : null,
          linked_file_id: scope === 'entity' ? fileId : null,
          linked_model_id: scope === 'entity' ? modelId : null,
          onProgress: (event) => {
            if (event.phase === 'hashing') setUploadPhase(t('uploadHashing'));
            else if (event.phase === 'uploading') setUploadPhase(t('uploadUploading'));
            else if (event.phase === 'completing') setUploadPhase(t('uploadCompleting'));
          },
        },
        {
          onSuccess: () => {
            setUploadPhase(null);
            toast.success(t('uploadSuccess'));
          },
          onError: () => {
            setUploadPhase(null);
            toast.error(t('uploadError'));
          },
        },
      );
    },
    [uploadMutation, scope, globalId, fileId, modelId, t],
  );

  const handleNoteSubmit = useCallback(() => {
    const text = noteText.trim();
    if (text === '') return;
    const blob = new Blob([text], { type: 'text/plain' });
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = new File([blob], `note-${now}.txt`, { type: 'text/plain' });
    uploadMutation.mutate(
      {
        file,
        description: text.slice(0, 200),
        linked_element_global_id: scope === 'entity' ? globalId : null,
        linked_file_id: scope === 'entity' ? fileId : null,
        linked_model_id: scope === 'entity' ? modelId : null,
        onProgress: (event) => {
          if (event.phase === 'hashing') setUploadPhase(t('uploadHashing'));
          else if (event.phase === 'uploading') setUploadPhase(t('uploadUploading'));
          else if (event.phase === 'completing') setUploadPhase(t('uploadCompleting'));
        },
      },
      {
        onSuccess: () => {
          setUploadPhase(null);
          setNoteText('');
          setShowNoteInput(false);
          toast.success(t('noteSuccess'));
        },
        onError: () => {
          setUploadPhase(null);
          toast.error(t('noteError'));
        },
      },
    );
  }, [noteText, uploadMutation, scope, globalId, fileId, modelId, t]);

  const handleDelete = useCallback(
    (attachmentId: string) => {
      deleteMutation.mutate(attachmentId, {
        onSuccess: () => toast.success(t('deleteSuccess')),
      });
    },
    [deleteMutation, t],
  );

  const isLoading =
    (scope === 'all' && allQuery.isLoading) ||
    (scope === 'entity' && entityQuery.isLoading) ||
    (scope === 'project' && projectQuery.isLoading) ||
    (scope === 'page' && pageQuery.isLoading);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border bg-background px-3.5 py-3">
        <div className="min-w-0">
          <div className="font-mono text-caption font-bold uppercase tracking-[0.1em] text-foreground-secondary">
            {scope === 'entity' && hasSelection
              ? t('attachToElement')
              : scope === 'page'
                ? t('tabOnPage')
                : scope === 'project'
                  ? t('tabProject')
                  : t('tabAll')}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {isPdf && onPdfPinModeChange !== undefined && (
            <Button
              variant={pdfPinMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onPdfPinModeChange(!pdfPinMode)}
              title={pdfPinMode ? t('pinModeOff') : t('pinModeOn')}
            >
              <MapPin className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNoteInput(!showNoteInput)}
            title={t('addNote')}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            title={scope === 'entity' && hasSelection ? t('attachToElement') : t('attachToProject')}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('attachButton')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
          onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
        />
      </div>

      {/* Upload progress */}
      {uploadPhase !== null && (
        <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-caption text-primary">{uploadPhase}</span>
        </div>
      )}

      {/* Note input */}
      {showNoteInput && (
        <div className="flex flex-col gap-2 border-b border-border bg-background px-3 py-2.5">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t('notePlaceholder')}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-background-secondary px-2.5 py-2 text-body3 text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowNoteInput(false); setNoteText(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={noteText.trim() === '' || uploadMutation.isPending}
              onClick={handleNoteSubmit}
            >
              {t('noteSubmit')}
            </Button>
          </div>
        </div>
      )}

      <PanelTabs tabs={tabs} active={scope} onChange={setScope} />

      {/* Search */}
      <div className="border-b border-border bg-background px-2.5 py-2">
        <div className="relative">
          <Paperclip className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('loading').replace('…', '')}
            inputSize="sm"
            className="pl-7"
          />
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {scope === 'entity' && !hasSelection ? (
          <PanelEmptyState icon={MousePointerClick} message={t('emptyNoSelection')} />
        ) : scope === 'entity' && (selectedAll || selected.size > 1) ? (
          <PanelEmptyState icon={Paperclip} message={t('emptyMultiSelection')} />
        ) : isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredItems.length === 0 ? (
          <PanelEmptyState
            icon={scope === 'page' ? MapPin : Paperclip}
            message={
              scope === 'entity'
                ? t('emptyNoItems')
                : scope === 'page'
                  ? t('emptyNoPage')
                  : scope === 'project'
                    ? t('emptyProjectEmpty')
                    : t('emptyAllEmpty')
            }
          />
        ) : (
          <div className="flex flex-col gap-1 p-1.5">
            {filteredItems.map((att) => (
              <AttachmentCard
                key={att.id}
                attachment={att}
                projectId={projectId}
                onView={() => setViewingAttachment(att)}
                onDelete={() => handleDelete(att.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Viewer dialog */}
      <AttachmentViewerDialog
        attachment={viewingAttachment}
        projectId={projectId}
        open={viewingAttachment !== null}
        onOpenChange={(open) => { if (!open) setViewingAttachment(null); }}
      />
    </div>
  );
}
