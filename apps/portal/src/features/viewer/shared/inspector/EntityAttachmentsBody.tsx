'use client';

import { FileText, LinkIcon, Loader2, MapPin, Paperclip, Plus, StickyNote } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useMemo, useRef, useState, type JSX,
} from 'react';
import { toast } from 'sonner';

import {
  Button, Input, Spinner, SplitButton, type SplitButtonItem,
} from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelStatusStrip } from '@/components/shared/viewer/shared/PanelStatusStrip';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { CreateCaptureLinkDialog } from '@/features/attachments/CreateCaptureLinkDialog';
import {
  useElementAttachments,
  useProjectAttachments,
  usePdfPageAttachments,
} from '@/features/attachments/useAttachments';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { AttachmentRow } from '@/features/viewer/shared/attachments/AttachmentRow';
import type { Attachment } from '@/lib/api/schemas';

const PENDING_PIN_KEY = 'bimstitch.pendingPdfPin';

/**
 * How the attachments shown here are linked. The 3D viewer scopes by IFC
 * element (`globalId`) or by the whole project (unlinked); the PDF viewer
 * scopes by page (pin-linked). The body renders identically for all three —
 * only the query and the upload link-vars differ.
 */
export type AttachmentScope =
  | { kind: 'element'; modelId: string; fileId: string; globalId: string }
  | { kind: 'project' }
  | {
      kind: 'pdf-page';
      fileId: string;
      modelId: string;
      page: number;
      pinMode: boolean;
      onPinModeChange: (enabled: boolean) => void;
    };

type LinkVars = {
  linked_element_global_id?: string;
  linked_file_id?: string;
  linked_model_id?: string;
};

/** Link-vars attached to a plain file/note upload (the pin flow adds a point). */
function buildLinkVars(scope: AttachmentScope): LinkVars {
  switch (scope.kind) {
    case 'element':
      return {
        linked_element_global_id: scope.globalId,
        linked_file_id: scope.fileId,
        linked_model_id: scope.modelId,
      };
    case 'pdf-page':
      return { linked_file_id: scope.fileId, linked_model_id: scope.modelId };
    case 'project':
    default:
      return {};
  }
}

type EntityAttachmentsBodyProps = {
  projectId: string;
  scope: AttachmentScope;
  /** When this nonce changes, auto-click the file picker to start the attach flow. */
  autoOpenNonce?: number | undefined;
  /** Called once the nonce has been consumed so the parent can clear it. */
  onAutoOpenConsumed?: () => void;
};

export function EntityAttachmentsBody({
  projectId,
  scope,
  autoOpenNonce,
  onAutoOpenConsumed,
}: EntityAttachmentsBodyProps): JSX.Element {
  const t = useTranslations('viewerAttachments');

  const [query, setQuery] = useState('');
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [captureLinkDialogOpen, setCaptureLinkDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastConsumedNonce = useRef<number | undefined>(undefined);
  const pinUploadRef = useRef(false);

  // Auto-open the native file picker when triggered from a context-menu command.
  // Note: the browser may block this if transient user activation has expired;
  // in that case the Attach button is right there as a one-click fallback.
  useEffect(() => {
    if (autoOpenNonce !== undefined && autoOpenNonce !== lastConsumedNonce.current) {
      lastConsumedNonce.current = autoOpenNonce;
      fileInputRef.current?.click();
      onAutoOpenConsumed?.();
    }
  }, [autoOpenNonce, onAutoOpenConsumed]);

  // Resolve the active query unconditionally (Hooks rules) — the inapplicable
  // queries are disabled via their `enabled`/null args.
  const elementScope = scope.kind === 'element' ? scope : null;
  const pdfScope = scope.kind === 'pdf-page' ? scope : null;
  const elementQuery = useElementAttachments(
    projectId,
    elementScope?.modelId ?? '',
    elementScope?.globalId ?? null,
  );
  const projectQuery = useProjectAttachments(projectId, scope.kind === 'project');
  const pdfPageQuery = usePdfPageAttachments(
    projectId,
    pdfScope?.fileId ?? '',
    pdfScope?.page ?? null,
  );
  const activeQuery =
    scope.kind === 'project' ? projectQuery
    : scope.kind === 'pdf-page' ? pdfPageQuery
    : elementQuery;

  const uploadMutation = useUploadAttachment(projectId);
  const deleteMutation = useDeleteAttachment(projectId);

  const items = activeQuery.data ?? [];
  const filteredItems = useMemo(() => {
    if (query.trim() === '') return items;
    const q = query.toLowerCase();
    return items.filter((a) => {
      if (a.original_filename.toLowerCase().includes(q)) return true;
      return a.description !== null && a.description.toLowerCase().includes(q);
    });
  }, [items, query]);

  const pinMode = scope.kind === 'pdf-page' ? scope.pinMode : false;
  const prevPinModeRef = useRef(pinMode);

  // PDF pin flow: when a pin is placed the page writes the dropped point into
  // sessionStorage and flips pin mode off. We consume it here and auto-fire the
  // file picker so the upload lands on the pin. Two triggers cover both cases:
  //  - the pin-mode true→false edge (the inspector panel was already open), and
  //  - mount (the panel was reopened after placement, e.g. from a closed state).
  // Reading + removing the key is idempotent, so firing both is harmless.
  const consumePendingPin = useCallback(() => {
    if (scope.kind !== 'pdf-page') return;
    const { fileId, modelId } = scope;
    const raw = sessionStorage.getItem(PENDING_PIN_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(PENDING_PIN_KEY);
    try {
      const pinData = JSON.parse(raw) as { type: string; page: number; x: number; y: number };
      if (pinData.type !== 'pdf') return;
      const input = fileInputRef.current;
      if (!input) return;
      pinUploadRef.current = true;
      const handler = (): void => {
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
  }, [scope, uploadMutation, t]);

  useEffect(() => {
    consumePendingPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wasPinMode = prevPinModeRef.current;
    prevPinModeRef.current = pinMode;
    if (wasPinMode && !pinMode) consumePendingPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinMode]);

  const handleFileUpload = useCallback(
    (files: FileList | null) => {
      if (pinUploadRef.current) return;
      if (files === null || files.length === 0) return;
      const [file] = files;
      if (file === undefined) return;
      uploadMutation.mutate(
        {
          file,
          ...buildLinkVars(scope),
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
    [uploadMutation, scope, t],
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
        ...buildLinkVars(scope),
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
  }, [noteText, uploadMutation, scope, t]);

  const handleDelete = useCallback(
    (attachmentId: string) => {
      deleteMutation.mutate(attachmentId, {
        onSuccess: () => toast.success(t('deleteSuccess')),
      });
    },
    [deleteMutation, t],
  );

  // SplitButton menu: file + note for every scope; "place pin" for PDF, and the
  // 3D-only "create capture link" otherwise. Keeps the toolbar identical.
  const splitItems: SplitButtonItem[] = [
    {
      id: 'file',
      label: t('attachFile'),
      icon: <FileText className="h-4 w-4" />,
      onSelect: () => { if (fileInputRef.current !== null) fileInputRef.current.click(); },
    },
    {
      id: 'note',
      label: t('addNote'),
      icon: <StickyNote className="h-4 w-4" />,
      onSelect: () => { setShowNoteInput(true); },
    },
  ];
  if (scope.kind === 'pdf-page') {
    const { onPinModeChange } = scope;
    splitItems.push({
      id: 'pin',
      label: t('placePin'),
      icon: <MapPin className="h-4 w-4" />,
      onSelect: () => { onPinModeChange(true); },
    });
  } else {
    splitItems.push({
      id: 'capture-link',
      label: t('createCaptureLink'),
      icon: <LinkIcon className="h-4 w-4" />,
      onSelect: () => { setCaptureLinkDialogOpen(true); },
    });
  }

  const emptyMessage =
    query.trim() !== ''
      ? t('emptyNoMatches', { query })
      : scope.kind === 'pdf-page'
        ? t('emptyNoPage')
        : scope.kind === 'project'
          ? t('emptyProjectEmpty')
          : t('emptyNoItems');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar + search in one row */}
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
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
        <SplitButton
          label={t('attachButton')}
          icon={<Plus className="h-3.5 w-3.5" />}
          disabled={uploadMutation.isPending}
          onClick={() => { if (fileInputRef.current !== null) fileInputRef.current.click(); }}
          menuLabel={t('moreAttachOptions')}
          items={splitItems}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => { handleFileUpload(e.target.files); }}
          onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
        />
      </div>

      {/* Pin-mode status strip (PDF only) */}
      {scope.kind === 'pdf-page' && scope.pinMode ? (
        <PanelStatusStrip
          tone="active"
          right={
            <button
              type="button"
              onClick={() => { scope.onPinModeChange(false); }}
              className="font-sans text-caption font-medium text-primary transition-colors hover:text-primary-hover"
            >
              {t('pinModeOff')}
            </button>
          }
        >
          {t('pinPlacing')}
        </PanelStatusStrip>
      ) : null}

      {/* Upload progress */}
      {uploadPhase !== null && (
        <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3.5 py-2">
          <Spinner size="sm" className="text-primary" />
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
              {t('cancel')}
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

      {/* List */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeQuery.isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredItems.length === 0 ? (
          <PanelEmptyState
            icon={scope.kind === 'pdf-page' ? MapPin : Paperclip}
            message={emptyMessage}
          />
        ) : (
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
                onDelete={() => { handleDelete(att.id); }}
              />
            ))}
            <div className="border-t border-border" />
          </div>
        )}
      </div>

      {/* Capture link dialog (3D scopes only mount the menu item, but keeping the
          dialog mounted is harmless and avoids a conditional hook boundary). */}
      <CreateCaptureLinkDialog
        projectId={projectId}
        open={captureLinkDialogOpen}
        onOpenChange={setCaptureLinkDialogOpen}
      />

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

/** Reads entity-attachment count via the same hook — drives the tab pill. */
export function useEntityAttachmentCount(
  projectId: string,
  modelId: string,
  globalId: string | null,
): number {
  const query = useElementAttachments(projectId, modelId, globalId);
  return query.data?.length ?? 0;
}
