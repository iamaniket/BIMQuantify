'use client';

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
import { type JSX } from 'react';

import { useImageAnnotator } from './useImageAnnotator';

type Props = {
  projectId: string;
  attachmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new (annotated head) attachment id after a successful save. */
  onAnnotated?: (newAttachmentId: string) => void;
};

export function ImageAnnotatorDialog({
  projectId,
  attachmentId,
  open,
  onOpenChange,
  onAnnotated,
}: Props): JSX.Element {
  const t = useTranslations('imageAnnotator');
  const editor = useImageAnnotator({ projectId, attachmentId, enabled: open });

  const handleSave = (): void => {
    editor.save((next) => {
      onAnnotated?.(next.id);
      onOpenChange(false);
    });
  };

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

        {!editor.ready ? (
          <DialogBody className="flex min-h-0 flex-1 items-center justify-center">
            {editor.failed ? (
              <p className="text-body3 text-foreground-tertiary">{t('loadError')}</p>
            ) : (
              <div className="flex flex-col items-center gap-2 text-foreground-tertiary">
                <Spinner className="text-primary" />
                <span className="text-body3">{t('loading')}</span>
              </div>
            )}
          </DialogBody>
        ) : (
          <>
            <div className="shrink-0 border-b border-border px-4 py-2">
              {editor.toolbar}
            </div>

            <DialogBody className="min-h-0 flex-1 overflow-hidden bg-[#101316] p-3">
              {editor.canvas}
            </DialogBody>

            <DialogFooter className="mx-0 shrink-0 items-center justify-between border-border bg-surface-low px-6 py-3.5">
              <span className="min-w-0 truncate text-caption text-foreground-tertiary">
                {editor.hint}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="border"
                  size="md"
                  onClick={() => { onOpenChange(false); }}
                  disabled={editor.isSaving}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleSave}
                  disabled={!editor.canSave}
                >
                  {editor.isSaving ? t('saving') : t('save')}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
