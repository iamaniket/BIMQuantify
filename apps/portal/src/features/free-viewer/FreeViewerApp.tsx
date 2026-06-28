'use client';

import { Button } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ApiError } from '@/lib/api/client';
import {
  deleteFreeModel,
  listFreeModels,
  uploadFreeModel,
  type FreeModel,
} from '@/lib/api/freeModels';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/providers/AuthProvider';

import { FreeViewerComingSoon } from './FreeViewerComingSoon';

const MAX_MODELS = 5;

export function FreeViewerApp(): JSX.Element {
  const t = useTranslations('freeViewer');
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;

  const [models, setModels] = useState<FreeModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (accessToken === undefined) return;
    try {
      setModels(await listFreeModels(accessToken));
      setDisabled(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FREE_TIER_DISABLED') {
        setDisabled(true);
      } else {
        setError(err instanceof ApiError ? err.detail : 'error');
      }
    } finally {
      setLoaded(true);
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (file === undefined || accessToken === undefined) return;
      setUploading(true);
      setError(null);
      try {
        await uploadFreeModel(accessToken, file);
        await refresh();
      } catch (err) {
        setError(
          err instanceof ApiError ? (err.localizedMessage ?? err.detail) : 'upload-failed',
        );
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [accessToken, refresh],
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (accessToken === undefined) return;
      try {
        await deleteFreeModel(accessToken, id);
        await refresh();
      } catch {
        setError('delete-failed');
      }
    },
    [accessToken, refresh],
  );

  if (loaded && disabled) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-16">
        <FreeViewerComingSoon />
      </div>
    );
  }

  const atCap = models.length >= MAX_MODELS;

  // Literal keys only — next-intl message keys are typed, so a dynamic
  // `t(`app.status.${s}`)` would not type-check.
  const statusLabel = (s: string): string => {
    switch (s) {
      case 'queued':
        return t('app.status.queued');
      case 'running':
        return t('app.status.running');
      case 'succeeded':
        return t('app.status.succeeded');
      case 'failed':
        return t('app.status.failed');
      default:
        return t('app.status.none');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="mb-1 text-caption uppercase tracking-wide text-foreground-tertiary">
        {t('eyebrow')}
      </p>
      <h1 className="mb-6 text-h2 font-sans text-foreground">{t('app.title')}</h1>

      <div className="mb-8 rounded-lg border border-border bg-surface-main p-6">
        <input
          ref={fileRef}
          type="file"
          accept=".ifc,.ifczip"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-body2 text-foreground">{t('app.uploadHeading')}</p>
            <p className="text-body3 text-foreground-tertiary">
              {t('app.capNote', { count: models.length, max: MAX_MODELS })}
            </p>
          </div>
          <Button
            variant="primary"
            disabled={uploading || atCap || accessToken === undefined}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? t('app.uploading') : t('app.uploadButton')}
          </Button>
        </div>
        {error !== null && (
          <p className="mt-3 text-body3 text-danger">{error}</p>
        )}
      </div>

      {models.length === 0 ? (
        <p className="text-body3 text-foreground-tertiary">{t('app.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {models.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-main px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-body2 text-foreground">{m.name}</p>
                <p className="text-body3 text-foreground-tertiary">
                  {statusLabel(m.extraction_status)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.extraction_status === 'succeeded' && (
                  <Link href={`/free-viewer/${m.id}`}>
                    <Button variant="secondary" size="sm">
                      {t('app.open')}
                    </Button>
                  </Link>
                )}
                <Button variant="ghost" size="sm" onClick={() => void onDelete(m.id)}>
                  {t('app.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 rounded-lg border border-border bg-surface-low p-5">
        <p className="text-body2 text-foreground">{t('app.upgradeHeading')}</p>
        <p className="mb-3 text-body3 text-foreground-tertiary">{t('app.upgradeBody')}</p>
        <Link href="/request-access">
          <Button variant="secondary" size="sm">
            {t('app.upgradeCta')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
