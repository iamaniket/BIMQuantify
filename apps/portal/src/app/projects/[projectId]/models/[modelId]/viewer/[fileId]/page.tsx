'use client';

import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';

import { Skeleton } from '@bimstitch/ui';
import type { ViewerBundle, ViewerHandle } from '@bimstitch/viewer';

import { ViewerToolbar } from '@/components/viewer/ViewerToolbar';

import { ApiError } from '@/lib/api/client';
import { getViewerBundle } from '@/lib/api/projectFiles';
import type { ViewerBundleResponse } from '@/lib/api/schemas';
import {
  DEFAULT_VIEWER_SETTINGS,
  loadViewerSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import { useAuth } from '@/providers/AuthProvider';

// next/dynamic with ssr:false because @bimstitch/viewer pulls in three.js
// + WASM and must run only in the browser.
const IfcViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.IfcViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

function buildBundle(response: ViewerBundleResponse): ViewerBundle {
  const out: ViewerBundle = { fragmentsUrl: response.fragments_url };
  if (response.metadata_url !== null) out.metadataUrl = response.metadata_url;
  if (response.properties_url !== null) out.propertiesUrl = response.properties_url;
  return out;
}

export default function ViewerPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string; modelId: string; fileId: string }>();
  const { projectId, modelId, fileId } = params;
  const { tokens, hasHydrated } = useAuth();

  const [bundle, setBundle] = useState<ViewerBundleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  // Viewer settings live in localStorage. We seed with defaults on the
  // server render; once mounted, we hydrate from storage in an effect to
  // avoid SSR/CSR mismatches.
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_VIEWER_SETTINGS);
  // Bumping this remounts <IfcViewer> so init-only options take effect.
  const [viewerEpoch, setViewerEpoch] = useState(0);

  useEffect(() => {
    setSettings(loadViewerSettings());
  }, []);

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  useEffect(() => {
    if (tokens === null) return undefined;
    const accessToken = tokens.access_token;
    const cancelToken = { cancelled: false };
    (async () => {
      try {
        const result = await getViewerBundle(accessToken, projectId, modelId, fileId);
        if (cancelToken.cancelled) return;
        setBundle(result);
      } catch (err) {
        if (cancelToken.cancelled) return;
        if (err instanceof ApiError) {
          setError(
            err.status === 404
              ? 'This file has not been processed yet, or extraction failed.'
              : err.detail,
          );
        } else {
          setError('Failed to load viewer bundle.');
        }
      }
    })().catch(() => undefined);
    return () => {
      cancelToken.cancelled = true;
    };
  }, [tokens, projectId, modelId, fileId]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  let body: JSX.Element;
  if (error !== null) {
    body = (
      <div
        role="alert"
        className="m-6 rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
      >
        {error}
      </div>
    );
  } else if (bundle === null) {
    body = <Skeleton className="absolute inset-0" />;
  } else {
    body = (
      <>
        <IfcViewer
          key={viewerEpoch}
          ref={viewerHandleRef}
          bundle={buildBundle(bundle)}
          viewCube={{
            enabled: settings.viewCube.enabled,
            corner: settings.viewCube.corner,
          }}
          shadows={{
            enabled: settings.shadows.enabled,
            quality: settings.shadows.quality,
          }}
          background={{ color: settings.background.color }}
          effects={settings.effects}
          shortcuts={settings.shortcuts}
          onReady={(handle) => {
            viewerHandleRef.current = handle;
            setViewerReady(true);
            const off = handle.events.on('selection:change', (payload) => {
              setSelectionCount(payload.selected.length);
            });
            // Stash the unsubscribe on a closure for unmount; the page is
            // a single mount per file, so leaking on tab switch is fine
            // (the viewer disposes events on unmount anyway).
            return off;
          }}
          onError={(err) => {
            setViewerError(err.message);
          }}
        />
        {viewerReady ? (
          <ViewerToolbar
            handle={viewerHandleRef.current}
            selectionCount={selectionCount}
            settings={settings}
            onSettingsChange={setSettings}
            onReloadViewer={() => {
              setViewerReady(false);
              setSelectionCount(0);
              setViewerEpoch((n) => n + 1);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-2 text-body2 text-foreground-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
        {viewerError !== null ? (
          <span className="text-caption text-error">{viewerError}</span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">{body}</div>
    </main>
  );
}
