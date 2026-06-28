'use client';

import { Button } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { PageShell } from '@/components/shared/layout/PageShell';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/client';
import {
  deleteFreeModel,
  listFreeModels,
  uploadFreeModel,
  type FreeModel,
} from '@/lib/api/freeModels';
import { useAuth } from '@/providers/AuthProvider';

import { FreeViewerComingSoon } from './FreeViewerComingSoon';

const MAX_MODELS = 5;

/** Status pill tone, mirroring the notification-bell palette. */
const NONE_TONE = 'bg-background-hover text-foreground-tertiary';
const STATUS_TONE: Record<string, string> = {
  succeeded: 'bg-success-lighter text-success',
  failed: 'bg-error-lighter text-error',
  running: 'bg-info-lighter text-info-hover',
  queued: 'bg-warning-lighter text-warning',
  none: NONE_TONE,
};

/**
 * Free-tier "Projects" home — the free (org-less) branch of the `/projects`
 * page. Lists the user's uploaded free models as cards (the org-less analogue
 * of projects), styled to match the paid dashboard. Reuses the free models API
 * (`/free/*`, user-scoped) and the `freeViewer.*` catalog. Cards open the
 * immersive viewer at `/free-viewer/[id]`.
 */
export function FreeProjectsView(): JSX.Element {
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
        setError(err instanceof ApiError ? (err.localizedMessage ?? err.detail) : 'upload-failed');
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

  // Literal keys only — next-intl message keys are typed.
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

  if (loaded && disabled) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-16">
        <FreeViewerComingSoon />
      </div>
    );
  }

  const atCap = models.length >= MAX_MODELS;

  const hero = (
    <div className="flex h-full flex-col justify-center gap-1 border-b border-border px-5">
      <p className="text-caption uppercase tracking-wide text-foreground-tertiary">{t('eyebrow')}</p>
      <h1 className="text-h2 font-sans text-foreground">{t('app.title')}</h1>
      <p className="text-body3 text-foreground-tertiary">
        {t('app.capNote', { count: models.length, max: MAX_MODELS })}
      </p>
    </div>
  );

  return (
    <PageShell hero={hero}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <input
          ref={fileRef}
          type="file"
          accept=".ifc,.ifczip"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-main p-4">
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

        {error !== null && <p className="mb-4 text-body3 text-danger">{error}</p>}

        {models.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{t('app.empty')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => {
              const ready = m.extraction_status === 'succeeded';
              const tone = STATUS_TONE[m.extraction_status] ?? NONE_TONE;
              return (
                <li
                  key={m.id}
                  className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface-main p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body2 font-medium text-foreground">{m.name}</p>
                    <p className="mt-1 truncate text-body3 text-foreground-tertiary">
                      {m.original_filename}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${tone}`}
                    >
                      {statusLabel(m.extraction_status)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {ready && (
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
                  </div>
                </li>
              );
            })}
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
    </PageShell>
  );
}
