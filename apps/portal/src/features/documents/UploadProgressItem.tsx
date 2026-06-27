'use client';

import { AlertCircle, CheckCircle2, X } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, Spinner } from '@bimdossier/ui';

import { formatFileSize, formatRejection } from '@/lib/formatting/files';

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'hashing'; fraction: number }
  | { kind: 'uploading' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

type Props = {
  filename: string;
  sizeBytes: number;
  state: UploadState;
  onRemove: (() => void) | undefined;
};

function StateIcon({ state }: { state: UploadState }): JSX.Element {
  if (state.kind === 'hashing' || state.kind === 'uploading') {
    return <Spinner className="h-4 w-4 text-foreground-secondary" />;
  }
  if (state.kind === 'success') {
    return <CheckCircle2 className="h-4 w-4 text-success" />;
  }
  if (state.kind === 'rejected' || state.kind === 'error') {
    return <AlertCircle className="h-4 w-4 text-error" />;
  }
  return <span className="h-4 w-4" />;
}

function stateMessage(
  state: UploadState,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'hashing') {
    const pct = Math.min(99, Math.round(state.fraction * 100));
    return t('hashing', { pct: String(pct) });
  }
  if (state.kind === 'uploading') return t('uploading');
  if (state.kind === 'success') return t('uploaded');
  if (state.kind === 'rejected') return formatRejection(state.reason);
  return state.message;
}

export function UploadProgressItem({
  filename, sizeBytes, state, onRemove,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documents.upload');
  const message = stateMessage(state, t);
  const messageClass = state.kind === 'rejected' || state.kind === 'error'
    ? 'text-error'
    : 'text-foreground-tertiary';

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background-secondary px-3 py-2">
      <StateIcon state={state} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body2 text-foreground">{filename}</span>
        <span className="text-caption text-foreground-tertiary">
          {formatFileSize(sizeBytes)}
          {message === null ? '' : ' · '}
          {message === null ? '' : <span className={messageClass}>{message}</span>}
        </span>
      </div>
      {onRemove === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="md"
          aria-label={t('removeAria', { filename })}
          className="h-8 w-8 p-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
