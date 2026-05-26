'use client';

import { Camera, CheckCircle, FileUp, Loader2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { validateCaptureToken, uploadViaCaptureLink } from '@/lib/api/capturePublic';
import type { CaptureTokenValidation } from '@/lib/api/schemas';
import { computeFileSha256 } from '@/lib/upload/sha256';

type Props = {
  orgId: string;
  token: string;
};

type PageState =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: 'expired' | 'revoked' | 'exhausted' | 'generic' }
  | { kind: 'ready'; info: CaptureTokenValidation }
  | { kind: 'uploading'; info: CaptureTokenValidation }
  | { kind: 'success'; info: CaptureTokenValidation; remainingUses: number | null }
  | { kind: 'exhausted' }
  | { kind: 'error'; info: CaptureTokenValidation };

export function CaptureUploadPage({ orgId, token }: Props): JSX.Element {
  const t = useTranslations('capturePage');
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void validateCaptureToken(orgId, token)
      .then((info) => {
        setState({ kind: 'ready', info });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 410) {
          const detail = err.detail.toLowerCase();
          if (detail.includes('expired')) {
            setState({ kind: 'invalid', reason: 'expired' });
          } else if (detail.includes('revoked')) {
            setState({ kind: 'invalid', reason: 'revoked' });
          } else if (detail.includes('exhausted') || detail.includes('limit')) {
            setState({ kind: 'invalid', reason: 'exhausted' });
          } else {
            setState({ kind: 'invalid', reason: 'generic' });
          }
        } else {
          setState({ kind: 'invalid', reason: 'generic' });
        }
      });
  }, [orgId, token]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (state.kind !== 'ready' && state.kind !== 'success' && state.kind !== 'error') return;
      const info = state.info;

      setState({ kind: 'uploading', info });

      try {
        const sha256 = await computeFileSha256(file);
        await uploadViaCaptureLink(orgId, token, file, sha256);

        const currentRemaining = state.kind === 'success'
          ? state.remainingUses
          : info.remaining_uses;
        const newRemaining = currentRemaining !== null ? currentRemaining - 1 : null;

        if (newRemaining !== null && newRemaining <= 0) {
          setState({ kind: 'exhausted' });
        } else {
          setState({ kind: 'success', info, remainingUses: newRemaining });
        }
      } catch {
        setState({ kind: 'error', info });
      }
    },
    [state, orgId, token],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null || files.length === 0) return;
      const file = files[0];
      if (file !== undefined) {
        void handleUpload(file);
      }
      e.target.value = '';
    },
    [handleUpload],
  );

  const handleUploadAnother = useCallback(() => {
    if (state.kind === 'success') {
      setState({ kind: 'ready', info: state.info });
    }
  }, [state]);

  const handleRetry = useCallback(() => {
    if (state.kind === 'error') {
      setState({ kind: 'ready', info: state.info });
    }
  }, [state]);

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-foreground-tertiary" />
        <p className="text-body3 text-foreground-secondary">{t('loading')}</p>
      </div>
    );
  }

  if (state.kind === 'invalid') {
    const messages: Record<string, string> = {
      expired: t('invalidExpired'),
      revoked: t('invalidRevoked'),
      exhausted: t('invalidExhausted'),
      generic: t('invalidGeneric'),
    };
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <XCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-h3 font-semibold text-foreground">{t('invalidTitle')}</h1>
        <p className="text-body3 text-foreground-secondary">{messages[state.reason]}</p>
      </div>
    );
  }

  if (state.kind === 'exhausted') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <XCircle className="h-10 w-10 text-warning" />
        <h1 className="text-h3 font-semibold text-foreground">{t('exhaustedTitle')}</h1>
        <p className="text-body3 text-foreground-secondary">{t('exhaustedDescription')}</p>
      </div>
    );
  }

  if (state.kind === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-body3 text-foreground-secondary">{t('uploading')}</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <XCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-h3 font-semibold text-foreground">{t('errorTitle')}</h1>
        <p className="text-body3 text-foreground-secondary">{t('errorDescription')}</p>
        <Button variant="primary" size="sm" onClick={handleRetry}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <CheckCircle className="h-10 w-10 text-success" />
        <h1 className="text-h3 font-semibold text-foreground">{t('successTitle')}</h1>
        <p className="text-body3 text-foreground-secondary">{t('successDescription')}</p>
        {state.remainingUses !== null && (
          <p className="text-caption text-foreground-tertiary">
            {t('remainingUses', { count: state.remainingUses })}
          </p>
        )}
        <Button variant="primary" size="sm" onClick={handleUploadAnother}>
          {t('uploadAnother')}
        </Button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.docx,.xlsx,.pptx,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    );
  }

  const info = state.info;

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <h1 className="text-h3 font-semibold text-foreground">
        {t('readyTitle', { project: info.project_name })}
      </h1>
      {info.label !== null && (
        <p className="text-caption text-foreground-tertiary">
          {t('linkLabel', { label: info.label })}
        </p>
      )}
      <p className="text-body3 text-foreground-secondary">{t('readyDescription')}</p>
      {info.remaining_uses !== null && (
        <p className="text-caption text-foreground-tertiary">
          {t('remainingUses', { count: info.remaining_uses })}
        </p>
      )}
      <div className="flex w-full flex-col gap-2.5 pt-2">
        <Button
          variant="primary"
          className="w-full py-4"
          onClick={() => { cameraInputRef.current?.click(); }}
        >
          <Camera className="mr-2 h-5 w-5" />
          {t('takePhoto')}
        </Button>
        <Button
          variant="border"
          className="w-full py-4"
          onClick={() => { fileInputRef.current?.click(); }}
        >
          <FileUp className="mr-2 h-5 w-5" />
          {t('chooseFile')}
        </Button>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.pdf,.docx,.xlsx,.pptx,.txt"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
