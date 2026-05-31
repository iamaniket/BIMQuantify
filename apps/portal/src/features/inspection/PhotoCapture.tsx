'use client';

import { Camera, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Button } from '@bimstitch/ui';

import { useAttachmentViewUrl } from '@/features/attachments/useAttachmentViewUrl';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';

type ThumbnailProps = {
  projectId: string;
  attachmentId: string;
  onRemove: () => void;
  disabled: boolean;
};

function Thumbnail({ projectId, attachmentId, onRemove, disabled }: ThumbnailProps): JSX.Element {
  const viewUrlQuery = useAttachmentViewUrl(projectId, attachmentId);
  const url = viewUrlQuery.data?.download_url;

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-low">
      {url !== undefined ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 inline-grid h-5 w-5 place-items-center rounded-full bg-background/80 text-foreground-tertiary hover:bg-background hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

type Props = {
  projectId: string;
  photoIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  maxPhotos?: number;
};

export function PhotoCapture({
  projectId,
  photoIds,
  onChange,
  disabled = false,
  maxPhotos = 5,
}: Props): JSX.Element {
  const t = useTranslations('inspection.photo');
  const uploadMutation = useUploadAttachment(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null) return;
      const picked = Array.from(files);
      if (inputRef.current !== null) inputRef.current.value = '';
      if (picked.length === 0) return;

      setUploadingCount((n) => n + picked.length);
      const added: string[] = [];
      for (const file of picked) {
        try {
          const attachment = await uploadMutation.mutateAsync({ file });
          added.push(attachment.id);
        } catch {
          toast.error(t('uploadFailed'));
        } finally {
          setUploadingCount((n) => n - 1);
        }
      }
      if (added.length > 0) {
        onChange([...photoIds, ...added]);
      }
    },
    [uploadMutation, onChange, photoIds, t],
  );

  const atMax = photoIds.length >= maxPhotos;

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="border"
        size="lg"
        className="min-h-12 w-full justify-start gap-2"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || atMax}
      >
        <Camera className="h-5 w-5" />
        {t('capture')}
        {photoIds.length > 0 && (
          <span className="ml-auto text-body3 text-foreground-tertiary">
            {photoIds.length}/{maxPhotos}
          </span>
        )}
      </Button>

      {(photoIds.length > 0 || uploadingCount > 0) && (
        <div className="flex gap-2 overflow-x-auto py-1">
          {photoIds.map((id) => (
            <Thumbnail
              key={id}
              projectId={projectId}
              attachmentId={id}
              disabled={disabled}
              onRemove={() => onChange(photoIds.filter((x) => x !== id))}
            />
          ))}
          {Array.from({ length: uploadingCount }).map((_, i) => (
            <div
              key={`uploading-${String(i)}`}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-low"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void handleFileChange(e); }}
      />
    </div>
  );
}
