'use client';

import { Label } from '@bimdossier/ui';
import { ImagePlus, Pencil, X } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';

import { ImageAnnotatorDialog } from '@/features/attachments/ImageAnnotatorDialog';
import { useAttachmentViewUrl } from '@/features/attachments/useAttachmentViewUrl';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { useIsPooledContext } from '@/hooks/useIsPooledContext';

type ThumbnailProps = {
  projectId: string;
  attachmentId: string;
  disabled: boolean;
  // Pooled (free) attachments have no versioning/annotation endpoint, so the
  // annotate affordance is hidden for them (it would 409 on save).
  annotatable: boolean;
  onRemove: () => void;
  onAnnotate: () => void;
};

function PhotoThumbnail({
  projectId,
  attachmentId,
  disabled,
  annotatable,
  onRemove,
  onAnnotate,
}: ThumbnailProps): JSX.Element {
  const t = useTranslations('findings.photos');
  const viewUrlQuery = useAttachmentViewUrl(projectId, attachmentId);
  const url = viewUrlQuery.data?.download_url;

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-border bg-surface-low">
      {url !== undefined ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      <button
        type="button"
        title={t('remove')}
        disabled={disabled}
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 inline-grid h-4 w-4 place-items-center rounded-full bg-background/80 text-foreground-tertiary transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3 w-3" />
      </button>
      {annotatable && (
        <button
          type="button"
          title={t('annotate')}
          disabled={disabled}
          onClick={onAnnotate}
          className="absolute bottom-0.5 right-0.5 inline-grid h-4 w-4 place-items-center rounded bg-background/80 text-foreground-tertiary transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

type Props = {
  projectId: string;
  photoIds: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  // Override the heading so the same picker reads as "resolution evidence"
  // when reused in the resolve flow; defaults to the photos label.
  label?: string;
};

export function FindingPhotos({
  projectId,
  photoIds,
  onChange,
  disabled = false,
  label,
}: Props): JSX.Element {
  const t = useTranslations('findings.photos');
  const uploadMutation = useUploadAttachment(projectId);
  // Pooled (free) attachments have no annotation/versioning endpoint — hide the
  // annotate affordance for free users (upload + view still work).
  const { isPooled } = useIsPooledContext();
  const annotatable = !isPooled;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [annotatingId, setAnnotatingId] = useState<string | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null) return;
      const picked = Array.from(files);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
      if (picked.length === 0) return;

      setUploadingCount((n) => n + picked.length);
      const added: string[] = [];
      for (const file of picked) {
        try {
          const attachment = await uploadMutation.mutateAsync({ file });
          added.push(attachment.id);
        } catch {
          toast.error(t('uploadError', { name: file.name }));
        } finally {
          setUploadingCount((n) => n - 1);
        }
      }
      // Functional updater: an upload batch settles asynchronously, so the
      // merge must read the *latest* selection — never the render-time
      // snapshot — or a removal made mid-upload gets silently overwritten and
      // the deleted photo resurrects (the remove/annotate handlers below merge
      // functionally for the same reason).
      if (added.length > 0) {
        onChange((prev) => [...prev, ...added]);
      }
    },
    [uploadMutation, onChange, t],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>{label ?? t('label')}</Label>
      <div className="flex flex-wrap gap-2">
        {photoIds.map((id) => (
          <PhotoThumbnail
            key={id}
            projectId={projectId}
            attachmentId={id}
            disabled={disabled}
            annotatable={annotatable}
            onRemove={() => { onChange((prev) => prev.filter((x) => x !== id)); }}
            onAnnotate={() => { setAnnotatingId(id); }}
          />
        ))}
        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div
            key={`uploading-${String(i)}`}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border bg-surface-low"
          >
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => { fileInputRef.current?.click(); }}
          className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-foreground-tertiary transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" />
          <span className="text-caption leading-none">{t('add')}</span>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { void handleFileChange(e); }}
      />
      {annotatable && (
        <ImageAnnotatorDialog
          projectId={projectId}
          attachmentId={annotatingId}
          open={annotatingId !== null}
          onOpenChange={(o) => { if (!o) setAnnotatingId(null); }}
          onAnnotated={(newId) => {
            onChange((prev) => prev.map((x) => (x === annotatingId ? newId : x)));
          }}
        />
      )}
    </div>
  );
}
