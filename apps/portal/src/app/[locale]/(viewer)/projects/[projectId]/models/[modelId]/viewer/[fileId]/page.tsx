'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';

import { Skeleton } from '@bimstitch/ui';
import type { ViewerBundle, ViewerHandle } from '@bimstitch/viewer';

import { ViewerContextMenu } from '@/components/viewer/ViewerContextMenu';
import { ViewerHeader } from '@/components/viewer/ViewerHeader';
import { ViewerSidePanel } from '@/components/viewer/ViewerSidePanel';
import { ViewerSideRail, type ViewerPanelId } from '@/components/viewer/ViewerSideRail';
import { ViewerStatusBar } from '@/components/viewer/ViewerStatusBar';
import { ViewerToolbar } from '@/components/viewer/ViewerToolbar';
import { ModelExplorer } from '@/components/viewer/explorer/ModelExplorer';
import { PropertiesPanel } from '@/components/viewer/properties/PropertiesPanel';
import { useModelMetadata } from '@/hooks/useModelMetadata';
import { useModelProperties } from '@/hooks/useModelProperties';
import { useViewerBridge } from '@/hooks/useViewerBridge';

import { ApiError } from '@/lib/api/client';
import { getViewerBundle } from '@/lib/api/projectFiles';
import { getProject } from '@/lib/api/projects';
import type { ViewerBundleResponse } from '@/lib/api/schemas';
import {
  DEFAULT_VIEWER_SETTINGS,
  loadViewerSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import { useAuth } from '@/providers/AuthProvider';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

const IfcViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.IfcViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const DocumentViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

function buildBundle(response: ViewerBundleResponse): ViewerBundle {
  const out: ViewerBundle = { fragmentsUrl: response.fragments_url! };
  if (response.metadata_url !== null) out.metadataUrl = response.metadata_url;
  if (response.properties_url !== null) out.propertiesUrl = response.properties_url;
  if (response.fragments_key !== null) out.cacheKey = response.fragments_key;
  return out;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function ViewerPage(): JSX.Element {
  const params = useParams<{ projectId: string; modelId: string; fileId: string }>();
  const { projectId, modelId, fileId } = params;
  const { tokens } = useAuth();

  const [bundle, setBundle] = useState<ViewerBundleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const selectionCount = useViewerEntityStore((s) => s.selected.size);
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_VIEWER_SETTINGS);
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const [activePanel, setActivePanel] = useState<ViewerPanelId | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);

  const togglePanel = useCallback((id: ViewerPanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  useViewerBridge(viewerHandleRef.current);

  const metadataUrl = bundle?.metadata_url ?? null;
  const propertiesUrl = bundle?.properties_url ?? null;
  const { data: metadata, isLoading: isLoadingMetadata } = useModelMetadata(metadataUrl);
  const { data: properties, isLoading: isLoadingProperties } = useModelProperties(
    propertiesUrl,
    activePanel === 'properties' && selectionCount > 0,
  );

  const [sceneReady, setSceneReady] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  const onProgress = useCallback((loaded: number, total: number) => {
    setProgress({ loaded, total });
  }, []);

  useEffect(() => {
    setSettings(loadViewerSettings());
  }, []);

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

  useEffect(() => {
    if (tokens === null) return undefined;
    const cancelToken = { cancelled: false };
    getProject(tokens.access_token, projectId)
      .then((project) => {
        if (!cancelToken.cancelled) setProjectName(project.name);
      })
      .catch(() => undefined);
    return () => {
      cancelToken.cancelled = true;
    };
  }, [tokens, projectId]);

  let viewerBody: JSX.Element;
  if (error !== null) {
    viewerBody = (
      <div
        role="alert"
        className="m-6 rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
      >
        {error}
      </div>
    );
  } else if (bundle === null) {
    viewerBody = <Skeleton className="absolute inset-0" />;
  } else if (bundle.file_type === 'pdf') {
    viewerBody = (
      <DocumentViewer
        fileUrl={bundle.file_url!}
        className="absolute inset-0"
        onError={(err) => {
          setViewerError(err.message);
        }}
      />
    );
  } else {
    viewerBody = (
      <>
        <IfcViewer
          key={viewerEpoch}
          ref={viewerHandleRef}
          bundle={buildBundle(bundle)}
          viewCube={{
            enabled: settings.viewCube.enabled,
          }}
          shadows={{
            enabled: settings.shadows.enabled,
          }}
          background={{ color: settings.background.color }}
          effects={settings.effects}
          shortcuts={settings.shortcuts}
          mouseBindings={settings.mouseBindings}
          controls={settings.controls}
          interactivePerformance={settings.interactivePerformance}
          onSceneReady={() => {
            setSceneReady(true);
          }}
          onProgress={onProgress}
          onReady={(handle) => {
            viewerHandleRef.current = handle;
            setViewerReady(true);
            setProgress(null);
          }}
          onError={(err) => {
            setViewerError(err.message);
          }}
        />
        {sceneReady && !viewerReady && progress !== null ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center pb-12">
            <div className="flex w-72 flex-col items-center gap-2 rounded-lg bg-background/80 px-4 py-3 shadow-md backdrop-blur-sm">
              <span className="text-caption text-foreground-secondary">
                Loading model… {formatMB(progress.loaded)} / {formatMB(progress.total)} MB
              </span>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
        <ViewerContextMenu handle={viewerHandleRef.current} />
        {viewerReady ? (
          <>
            <ViewerSidePanel
              activePanel={activePanel}
              onClose={closePanel}
              explorerContent={
                <ModelExplorer
                  metadata={metadata}
                  isLoading={isLoadingMetadata}
                />
              }
              propertiesContent={
                <PropertiesPanel
                  metadata={metadata}
                  properties={properties}
                  isLoadingProperties={isLoadingProperties}
                />
              }
            />
            <ViewerSideRail
              activePanel={activePanel}
              onTogglePanel={togglePanel}
            />
          </>
        ) : null}
        {viewerReady ? (
          <ViewerToolbar
            handle={viewerHandleRef.current}
            selectionCount={selectionCount}
            settings={settings}
            onSettingsChange={setSettings}
            onReloadViewer={() => {
              setViewerReady(false);
              setSceneReady(false);
              setProgress(null);
              setViewerEpoch((n) => n + 1);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <ViewerHeader projectId={projectId} projectName={projectName} />
      <div className="relative min-h-0 flex-1">
        {viewerBody}
        {viewerError !== null ? (
          <div
            role="alert"
            className="pointer-events-none absolute left-4 top-2 z-40 rounded-md bg-error-lighter px-2 py-1 text-caption text-error shadow-sm"
          >
            {viewerError}
          </div>
        ) : null}
      </div>
      <ViewerStatusBar metadata={metadata} viewerReady={viewerReady} />
    </main>
  );
}
