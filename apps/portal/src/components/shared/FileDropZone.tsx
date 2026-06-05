'use client';

import { UploadCloud } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useRef, useState,
  type ChangeEvent, type DragEvent, type JSX, type ReactNode,
} from 'react';

import { Button, cn } from '@bimstitch/ui';

type Props = {
  accept: string;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
  hint?: ReactNode;
};

export function FileDropZone({
  accept,
  multiple = false,
  onFiles,
  hint,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const t = useTranslations('common.dropzone');

  const handleFiles = useCallback((files: FileList | null): void => {
    if (files === null || files.length === 0) return;
    onFiles(files);
  }, [onFiles]);

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    handleFiles(event.target.files);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => { setIsDragging(false); }}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-border bg-background-secondary',
      )}
    >
      <UploadCloud className="h-6 w-6 text-foreground-tertiary" />
      <p className="text-body3 text-foreground">{t('prompt')}</p>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => { inputRef.current?.click(); }}
      >
        {t('chooseFile')}
      </Button>
      {hint !== undefined && (
        <p className="text-caption text-foreground-tertiary">{hint}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}
