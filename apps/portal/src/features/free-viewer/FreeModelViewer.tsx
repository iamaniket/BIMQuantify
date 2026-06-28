'use client';

import { Button } from '@bimdossier/ui';
import type { ViewerBundle } from '@bimdossier/viewer';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { ApiError } from '@/lib/api/client';
import { getFreeViewerBundle } from '@/lib/api/freeModels';
import {
  createFreeSnag,
  deleteFreeSnag,
  listFreeSnags,
  updateFreeSnag,
  type FreeSnag,
} from '@/lib/api/freeSnags';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/providers/AuthProvider';

const IfcViewer = dynamic(() => import('@bimdossier/viewer').then((m) => m.IfcViewer), {
  ssr: false,
});

type Severity = 'low' | 'medium' | 'high';
const SEVERITIES: Severity[] = ['low', 'medium', 'high'];

export function FreeModelViewer({ modelId }: { modelId: string }): JSX.Element {
  const t = useTranslations('freeViewer');
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token;

  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken === undefined) return;
    let active = true;
    void (async () => {
      try {
        const b = await getFreeViewerBundle(accessToken, modelId);
        if (!active) return;
        setBundle({
          fragmentsUrl: b.fragments_url,
          modelId: b.scene_id,
          cacheKey: b.scene_id,
          ...(b.metadata_url !== null ? { metadataUrl: b.metadata_url } : {}),
          ...(b.properties_url !== null ? { propertiesUrl: b.properties_url } : {}),
          ...(b.outline_url !== null ? { outlineUrl: b.outline_url } : {}),
        });
      } catch (err) {
        if (active) {
          setBundleError(err instanceof ApiError ? err.detail : 'error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, modelId]);

  return (
    <div className="flex h-screen">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-surface-main px-4 py-2">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              {t('viewer.back')}
            </Button>
          </Link>
          <span className="text-body3 text-foreground-tertiary">{t('viewer.title')}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          {bundleError !== null ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-body3 text-danger">{t('viewer.loadError')}</p>
            </div>
          ) : bundle === null ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-body3 text-foreground-tertiary">{t('viewer.loading')}</p>
            </div>
          ) : (
            <IfcViewer bundle={bundle} className="h-full w-full" />
          )}
        </div>
      </div>
      <FreeSnagPanel modelId={modelId} accessToken={accessToken} />
    </div>
  );
}

function FreeSnagPanel({
  modelId,
  accessToken,
}: {
  modelId: string;
  accessToken: string | undefined;
}): JSX.Element {
  const t = useTranslations('freeViewer');
  const [snags, setSnags] = useState<FreeSnag[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (accessToken === undefined) return;
    try {
      setSnags(await listFreeSnags(accessToken, modelId));
    } catch {
      /* non-fatal: keep the last list */
    }
  }, [accessToken, modelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAdd = useCallback(async () => {
    if (accessToken === undefined || title.trim() === '') return;
    setBusy(true);
    try {
      await createFreeSnag(accessToken, modelId, {
        title: title.trim(),
        note: note.trim() === '' ? null : note.trim(),
        severity,
      });
      setTitle('');
      setNote('');
      setSeverity('medium');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [accessToken, modelId, title, note, severity, refresh]);

  const onToggle = useCallback(
    async (snag: FreeSnag) => {
      if (accessToken === undefined) return;
      await updateFreeSnag(accessToken, snag.id, {
        status: snag.status === 'open' ? 'closed' : 'open',
      });
      await refresh();
    },
    [accessToken, refresh],
  );

  const onDelete = useCallback(
    async (snagId: string) => {
      if (accessToken === undefined) return;
      await deleteFreeSnag(accessToken, snagId);
      await refresh();
    },
    [accessToken, refresh],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-main">
      <div className="border-b border-border px-4 py-3">
        <p className="text-body2 text-foreground">{t('viewer.snags')}</p>
      </div>
      <div className="flex flex-col gap-2 border-b border-border p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('viewer.snagTitle')}
          className="rounded-md border border-border bg-surface-low px-3 py-2 text-body3 text-foreground"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('viewer.snagNote')}
          rows={2}
          className="rounded-md border border-border bg-surface-low px-3 py-2 text-body3 text-foreground"
        />
        <div className="flex gap-1">
          {SEVERITIES.map((s) => (
            <Button
              key={s}
              variant={severity === s ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setSeverity(s)}
            >
              {t(
                s === 'low'
                  ? 'viewer.sevLow'
                  : s === 'medium'
                    ? 'viewer.sevMedium'
                    : 'viewer.sevHigh',
              )}
            </Button>
          ))}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || title.trim() === ''}
          onClick={() => void onAdd()}
        >
          {t('viewer.addSnag')}
        </Button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        {snags.map((snag) => (
          <li
            key={snag.id}
            className="rounded-md border border-border bg-surface-low px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={
                  snag.status === 'closed'
                    ? 'text-body3 text-foreground-tertiary line-through'
                    : 'text-body3 text-foreground'
                }
              >
                {snag.title}
              </p>
              <span className="shrink-0 text-caption uppercase text-foreground-tertiary">
                {snag.severity}
              </span>
            </div>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="text-caption text-foreground-tertiary hover:text-foreground"
                onClick={() => void onToggle(snag)}
              >
                {snag.status === 'open' ? t('viewer.close') : t('viewer.reopen')}
              </button>
              <button
                type="button"
                className="text-caption text-foreground-tertiary hover:text-danger"
                onClick={() => void onDelete(snag.id)}
              >
                {t('viewer.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
