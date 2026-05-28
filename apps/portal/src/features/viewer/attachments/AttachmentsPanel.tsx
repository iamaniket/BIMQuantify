'use client';

import {
  Loader2,
  MapPin,
  MousePointerClick,
  Paperclip,
  Plus,
  StickyNote,
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
import type { Attachment } from '@/lib/api/schemas';
import type { ModelMetadata, ElementEntry } from '@/lib/api/viewerTypes';
import {
  useViewerEntityStore,
  parseEntityKey,
} from '@/stores/viewerEntityStore';

import { AttachmentRow } from './AttachmentRow';
import { LinkPrompt } from './LinkPrompt';

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

function headerLabel(
  t: ReturnType<typeof useTranslations>,
  scope: Scope,
  hasSelection: boolean,
): string {
  if (scope === 'entity' && hasSelection) return t('attachToElement');
  if (scope === 'page') return t('tabOnPage');
  if (scope === 'project') return t('tabProject');
  return t('tabAll');
}

function emptyMessage(
  t: ReturnType<typeof useTranslations>,
  query: string,
  scope: Scope,
): string {
  if (query.trim() !== '') return t('emptyNoMatches', { query });
  if (scope === 'entity') return t('emptyNoItems');
  if (scope === 'page') return t('emptyNoPage');
  if (scope === 'project') return t('emptyProjectEmpty');
  return t('emptyAllEmpty');
}

type PanelContentProps = {
  scope: Scope;
  hasSelection: boolean;
  selectedAll: boolean;
  selectedSize: number;
  isLoading: boolean;
  filteredItems: Attachment[];
  query: string;
  projectId: string;
  expandedId: string | null;
  setExpandedId: (fn: (prev: string | null) => string | null) => void;
  setViewingAttachment: (att: Attachment) => void;
  linkingId: string | null;
  setLinkingId: (fn: (prev: string | null) => string | null) => void;
  handleDelete: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
};

function PanelContent({
  scope,
  hasSelection,
  selectedAll,
  selectedSize,
  isLoading,
  filteredItems,
  query,
  projectId,
  expandedId,
  setExpandedId,
  setViewingAttachment,
  linkingId,
  setLinkingId,
  handleDelete,
  t,
}: PanelContentProps): JSX.Element {
  if (scope === 'entity' && !hasSelection) {
    return <PanelEmptyState icon={MousePointerClick} message={t('emptyNoSelection')} />;
  }
  if (scope === 'entity' && (selectedAll || selectedSize > 1)) {
    return <PanelEmptyState icon={Paperclip} message={t('emptyMultiSelection')} />;
  }
  if (isLoading) {
    return <PanelEmptyState icon={Loader2} message={t('loading')} />;
  }
  if (filteredItems.length === 0) {
    return (
      <PanelEmptyState
        icon={scope === 'page' ? MapPin : Paperclip}
        message={emptyMessage(t, query, scope)}
      />
    );
  }
  return (
    <div className="flex flex-col">
      {filteredItems.map((att) => (
        <AttachmentRow
          key={att.id}
          attachment={att}
          projectId={projectId}
          expanded={expandedId === att.id}
          onToggle={() => {
            setExpandedId((prev) => (prev === att.id ? null : att.id));
          }}
          onView={() => { setViewingAttachment(att); }}
          onLink={() => {
            setLinkingId((prev) => (prev === att.id ? null : att.id));
          }}
          onDelete={() => { handleDelete(att.id); }}
          linkingId={linkingId}
        />
      ))}
      <div className="border-t border-border" />
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
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
    let items: Attachment[];
    if (scope === 'entity') items = entityItems;
    else if (scope === 'project') items = projectItems;
    else if (scope === 'page') items = pageItems;
    else items = allItems;
    if (query.trim() === '') return items;
    const q = query.toLowerCase();
    return items.filter((a) => {
      if (a.original_filename.toLowerCase().includes(q)) return true;
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
      return a.description !== null && a.description.toLowerCase().includes(q);
    });
  }, [scope, entityItems, projectItems, pageItems, allItems, query]);

  const tabs: TabDef<Scope>[] = isPdf
    ? [
      { id: 'all', label: t('tabAll'), count: allItems.length },
      { id: 'page', label: t('tabOnPage'), count: pageItems.length },
      { id: 'project', label: t('tabProject'), count: projectItems.length },
    ]
    : [
      { id: 'all', label: t('tabAll'), count: allItems.length },
      {
        id: 'entity',
        label: t('tabOnEntity'),
        count: entityItems.length,
        disabled: !hasSelection,
      },
      { id: 'project', label: t('tabProject'), count: projectItems.length },
    ];

  const linkingAttachment = linkingId !== null
    ? filteredItems.find((a) => a.id === linkingId) ?? null
    : null;

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_PIN_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(PENDING_PIN_KEY);
    try {
      const pinData = JSON.parse(raw) as { type: string; page: number; x: number; y: number };
      if (pinData.type !== 'pdf') return;
      const input = fileInputRef.current;
      if (!input) return;
      pinUploadRef.current = true;
      const handler = () => {
        pinUploadRef.current = false;
        const { files } = input;
        if (files === null || files.length === 0) return;
        const [file] = files;
        if (file === undefined) return;
        uploadMutation.mutate(
          {
            file,
            linked_file_id: fileId,
            linked_model_id: modelId,
            linked_point: pinData,
            onProgress: (event) => {
              if (event.phase === 'hashing') setUploadPhase(t('uploadHashing'));
              else if (event.phase === 'uploading') setUploadPhase(t('uploadUploading'));
              else setUploadPhase(t('uploadCompleting'));
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
      if (files === null || files.length === 0) return;
      const [file] = files;
      if (file === undefined) return;
      uploadMutation.mutate(
        {
          file,
          linked_element_global_id: scope === 'entity' ? globalId : null,
          linked_file_id: scope === 'entity' ? fileId : null,
          linked_model_id: scope === 'entity' ? modelId : null,
          onProgress: (event) => {
            if (event.phase === 'hashing') setUploadPhase(t('uploadHashing'));
            else if (event.phase === 'uploading') setUploadPhase(t('uploadUploading'));
            else setUploadPhase(t('uploadCompleting'));
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
          else setUploadPhase(t('uploadCompleting'));
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

  const isLoading = (scope === 'all' && allQuery.isLoading)
    || (scope === 'entity' && entityQuery.isLoading)
    || (scope === 'project' && projectQuery.isLoading)
    || (scope === 'page' && pageQuery.isLoading);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border bg-background px-3.5 py-3">
        <div className="min-w-0">
          <div className="font-mono text-caption font-bold uppercase tracking-[0.1em] text-foreground-secondary">
            {headerLabel(t, scope, hasSelection)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {isPdf && onPdfPinModeChange !== undefined && (
            <Button
              variant={pdfPinMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => { onPdfPinModeChange(!pdfPinMode); }}
              title={pdfPinMode ? t('pinModeOff') : t('pinModeOn')}
            >
              <MapPin className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowNoteInput(!showNoteInput); }}
            title={t('addNote')}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={uploadMutation.isPending}
            onClick={() => { if (fileInputRef.current !== null) fileInputRef.current.click(); }}
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
          onChange={(e) => { handleFileUpload(e.target.files); }}
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
            onChange={(e) => { setNoteText(e.target.value); }}
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
      <div className="border-b border-border bg-surface-low px-2.5 py-2">
        <div className="relative">
          <Paperclip className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder={t('filterPlaceholder')}
            inputSize="sm"
            className="pl-7"
          />
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        <PanelContent
          scope={scope}
          hasSelection={hasSelection}
          selectedAll={selectedAll}
          selectedSize={selected.size}
          isLoading={isLoading}
          filteredItems={filteredItems}
          query={query}
          projectId={projectId}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          setViewingAttachment={setViewingAttachment}
          linkingId={linkingId}
          setLinkingId={setLinkingId}
          handleDelete={handleDelete}
          t={t}
        />
      </div>

      {/* Link-mode footer prompt */}
      {linkingAttachment !== null && (
        <LinkPrompt
          attachment={linkingAttachment}
          onCancel={() => { setLinkingId(null); }}
          onPickElement={() => { /* TODO: integrate with viewer pick mode */ }}
          onPickPdf={() => { /* TODO: integrate with PDF region draw */ }}
        />
      )}

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
