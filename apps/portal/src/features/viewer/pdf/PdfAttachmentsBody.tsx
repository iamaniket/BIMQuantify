'use client';

import {
  Loader2, MapPin, Paperclip, Plus, StickyNote,
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

import { Button, Input, Spinner } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { usePdfPageAttachments } from '@/features/attachments/useAttachments';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { AttachmentRow } from '@/features/viewer/shared/attachments/AttachmentRow';
import type { Attachment } from '@/lib/api/schemas';

const PENDING_PIN_KEY = 'bimstitch.pendingPdfPin';

type PdfAttachmentsBodyProps = {
  projectId: string;
  modelId: string;
  fileId: string;
  pdfCurrentPage: number;
  pdfPinMode: boolean;
  onPdfPinModeChange: (enabled: boolean) => void;
};

export function PdfAttachmentsBody({
  projectId,
  modelId,
  fileId,
  pdfCurrentPage,
  pdfPinMode,
  onPdfPinModeChange,
}: PdfAttachmentsBodyProps): JSX.Element {
  const t = useTranslations('viewerAttachments');

  const [query, setQuery] = useState('');
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinUploadRef = useRef(false);

  const pageQuery = usePdfPageAttachments(projectId, fileId, pdfCurrentPage);
  const uploadMutation = useUploadAttachment(projectId);
  const deleteMutation = useDeleteAttachment(projectId);

  const items = pageQuery.data ?? [];
  const filteredItems = useMemo(() => {
    if (query.trim() === '') return items;
    const q = query.toLowerCase();
    return items.filter((a) => {
      if (a.original_filename.toLowerCase().includes(q)) return true;
      return a.description !== null && a.description.toLowerCase().includes(q);
    });
  }, [items, query]);

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
          linked_file_id: fileId,
          linked_model_id: modelId,
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
    [uploadMutation, fileId, modelId, t],
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
        linked_file_id: fileId,
        linked_model_id: modelId,
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
  }, [noteText, uploadMutation, fileId, modelId, t]);

  const handleDelete = useCallback(
    (attachmentId: string) => {
      deleteMutation.mutate(attachmentId, {
        onSuccess: () => toast.success(t('deleteSuccess')),
      });
    },
    [deleteMutation, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-background px-3.5 py-2.5">
        <div className="font-sans text-caption font-bold uppercase tracking-[0.1em] text-foreground-secondary">
          {t('tabOnPage')}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant={pdfPinMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => { onPdfPinModeChange(!pdfPinMode); }}
            title={pdfPinMode ? t('pinModeOff') : t('pinModeOn')}
          >
            <MapPin className="h-3.5 w-3.5" />
          </Button>
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
            title={t('attachButton')}
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

      {/* List */}
      <div className="min-h-0 flex-1 overflow-auto">
        {pageQuery.isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredItems.length === 0 ? (
          <PanelEmptyState
            icon={MapPin}
            message={query.trim() !== '' ? t('emptyNoMatches', { query }) : t('emptyNoPage')}
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
