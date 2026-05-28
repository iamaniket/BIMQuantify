'use client';

import { Box, FileText, Link as LinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type { Attachment } from '@/lib/api/schemas';

type Props = {
  attachment: Attachment;
  onCancel: () => void;
  onPickElement: () => void;
  onPickPdf: () => void;
};

export function LinkPrompt({
  attachment,
  onCancel,
  onPickElement,
  onPickPdf,
}: Props): JSX.Element {
  const t = useTranslations('viewerAttachments');
  return (
    <div className="border-t-2 border-primary bg-primary-lighter px-3.5 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <LinkIcon className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-primary">
          {t('linkingTitle')}
        </span>
        <div className="flex-1" />
        <Button variant="border" size="sm" onClick={onCancel}>
          {t('linkingCancel')}
        </Button>
      </div>
      <p className="mb-2 text-body3 text-foreground-secondary">
        {t('linkingDescription')}{' '}
        <strong className="text-foreground">{attachment.original_filename}</strong>
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onPickElement}
          className="flex items-center gap-2 rounded border border-border bg-background p-2 text-left transition-colors hover:bg-background-secondary"
        >
          <Box className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="flex flex-col gap-px">
            <span className="text-body3 font-semibold text-foreground">{t('linkingElement')}</span>
            <span className="font-mono text-[10.5px] text-foreground-tertiary">{t('linkingElementSub')}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onPickPdf}
          className="flex items-center gap-2 rounded border border-border bg-background p-2 text-left transition-colors hover:bg-background-secondary"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-info-hover" />
          <span className="flex flex-col gap-px">
            <span className="text-body3 font-semibold text-foreground">{t('linkingPdf')}</span>
            <span className="font-mono text-[10.5px] text-foreground-tertiary">{t('linkingPdfSub')}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
