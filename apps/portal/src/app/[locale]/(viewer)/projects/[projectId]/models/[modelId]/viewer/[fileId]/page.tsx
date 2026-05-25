'use client';

import { useQuery } from '@tanstack/react-query';
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
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import type {
  DocumentActiveTool,
  DocumentRotation,
  DocumentViewerHandle,
  ViewerBundle,
  ViewerHandle,
} from '@bimstitch/viewer';

import { useAppHeader } from '@/components/shared/header/AppHeaderContext';
import { DocumentToolbar } from '@/components/shared/viewer/DocumentToolbar';
import { ModeIndicator } from '@/components/shared/viewer/ModeIndicator';
import { SideRail, type PanelId, type Mode } from '@/components/shared/viewer/SideRail';
import { Toolbar } from '@/components/shared/viewer/Toolbar';
import { BcfPanel, BcfHeaderActions } from '@/components/shared/viewer/bcf/BcfPanel';
import { MeasurementPanel, MeasurementHeaderActions } from '@/components/shared/viewer/measurement/MeasurementPanel';
import { PagesPanel } from '@/components/shared/viewer/pages/PagesPanel';
import { ContextMenu } from '@/features/viewer/ContextMenu';
import { ModelExplorer } from '@/features/viewer/explorer/ModelExplorer';
import { PropertiesPanel } from '@/features/viewer/properties/PropertiesPanel';
import { SidePanel } from '@/features/viewer/SidePanel';
import { StatusBar } from '@/features/viewer/StatusBar';
import { useDocumentShortcuts } from '@/features/viewer/useDocumentShortcuts';
import { useModelMetadata } from '@/features/viewer/useModelMetadata';
import { useModelProperties } from '@/features/viewer/useModelProperties';
import { viewerKeys } from '@/features/viewer/queryKeys';
import { useViewerBridge } from '@/features/viewer/useViewerBridge';
import { useViewerMode } from '@/features/viewer/useViewerMode';

import { ApiError } from '@/lib/api/client';
import { getViewerBundle } from '@/lib/api/projectFiles';
import type { ViewerBundleResponse } from '@/lib/api/schemas';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  loadDocumentSettings,
  type DocumentSettings,
} from '@/lib/documentSettings';
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

function bundleErrorMessage(err: Error | null): string | null {
  if (err === null) return null;
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return 'This file has not been processed yet, or extraction failed.';
    }
    return err.detail;
  }
  return 'Failed to load viewer bundle.';
}

export default function ViewerPage(): JSX.Element {
  const params = useParams<{ projectId: string; modelId: string; fileId: string }>();
  const { projectId, modelId, fileId } = params;
  const { tokens } = useAuth();

  const accessToken = tokens === null ? null : tokens.access_token;
  const bundleQuery = useQuery({
    queryKey: viewerKeys.bundle(projectId, modelId, fileId),
    queryFn: () => {
      if (accessToken === null) throw new Error('Not authenticated');
      return getViewerBundle(accessToken, projectId, modelId, fileId);
    },
    enabled: accessToken !== null,
    staleTime: 60_000,
  });
  const bundle: ViewerBundleResponse | null = bundleQuery.data ?? null;
  const error: string | null = bundleErrorMessage(bundleQuery.error);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const selectionCount = useViewerEntityStore((s) => s.selected.size);
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_VIEWER_SETTINGS);
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  // PDF-mode state — owned here so the toolbar, pages panel, status bar, and
  // DocumentViewer all read/write the same source of truth.
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfActiveTool, setPdfActiveTool] = useState<DocumentActiveTool>('select');
  const [pdfRotation, setPdfRotation] = useState<DocumentRotation>(0);
  const [pdfSettings, setPdfSettings] = useState<DocumentSettings>(DEFAULT_DOCUMENT_SETTINGS);
  const [documentHandle, setDocumentHandle] = useState<DocumentViewerHandle | null>(null);

  const togglePanel = useCallback((id: PanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  useAppHeader({
    statusLabel: selectionCount > 0 ? `${String(selectionCount)} selected` : null,
    statusTone: 'warning',
  });

  useViewerBridge(viewerHandleRef.current);
  const modeState = useViewerMode(viewerHandleRef.current);
  const isEditMode = modeState.mode === 'edit';

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
    setPdfSettings(loadDocumentSettings());
  }, []);

  // Reset PDF state when switching to a different file.
  useEffect(() => {
    setPdfCurrentPage(1);
    setPdfNumPages(null);
    setPdfScale(1);
    setPdfRotation(0);
    setPdfActiveTool('select');
  }, [fileId]);

  const handlePdfLoaded = useCallback(({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
  }, []);

  const handlePdfError = useCallback((err: Error) => {
    setViewerError(err.message);
  }, []);

  const mode: Mode = bundle?.file_type === 'pdf' ? 'pdf' : 'ifc';
  const isPdf = mode === 'pdf';
  const isIfc = mode === 'ifc';
  const shellReady = bundle !== null && error === null;
  const ifcShellReady = shellReady && isIfc && viewerReady;
  const pdfShellReady = shellReady && isPdf;
  // Render the chrome (side rail, side panel, toolbar placeholder) as soon
  // as the page mounts — the only thing we wait for is the bundle URL, and
  // even that is usually prefetched on hover. The canvas area shows its own
  // skeleton/progress UI underneath while the file loads.
  const showChrome = error === null;
  const showToolbarPlaceholder = showChrome && !ifcShellReady && !pdfShellReady;

  useDocumentShortcuts({
    enabled: isPdf && documentHandle !== null,
    shortcuts: pdfSettings.shortcuts,
    handlers: {
      zoomIn: () => documentHandle?.zoomIn(),
      zoomOut: () => documentHandle?.zoomOut(),
      fitPage: () => documentHandle?.fitPage(),
      fitWidth: () => documentHandle?.fitWidth(),
      actualSize: () => documentHandle?.actualSize(),
      rotateRight: () => documentHandle?.rotateBy(90),
      rotateLeft: () => documentHandle?.rotateBy(-90),
      nextPage: () => {
        setPdfCurrentPage((p) => {
          if (pdfNumPages === null) return p;
          return Math.min(p + 1, pdfNumPages);
        });
      },
      prevPage: () => {
        setPdfCurrentPage((p) => Math.max(1, p - 1));
      },
      firstPage: () => setPdfCurrentPage(1),
      lastPage: () => {
        if (pdfNumPages !== null) setPdfCurrentPage(pdfNumPages);
      },
      toolSelect: () => setPdfActiveTool('select'),
      toolPan: () => setPdfActiveTool('pan'),
      toolZoom: () => setPdfActiveTool('zoom'),
    },
  });

  let canvas: JSX.Element | null = null;
  if (error !== null) {
    canvas = (
      <ErrorBanner message={error} tone="soft" className="m-6 text-body2" />
    );
  } else if (bundle === null) {
    canvas = <Skeleton className="absolute inset-0" />;
  } else if (isPdf) {
    canvas = (
      <DocumentViewer
        ref={setDocumentHandle}
        fileUrl={bundle.file_url!}
        currentPage={pdfCurrentPage}
        scale={pdfScale}
        rotation={pdfRotation}
        activeTool={pdfActiveTool}
        className="absolute inset-0"
        onLoaded={handlePdfLoaded}
        onError={handlePdfError}
        onScaleChange={setPdfScale}
        onRotationChange={setPdfRotation}
      />
    );
  } else {
    canvas = (
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
    );
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {canvas}

        {isIfc && sceneReady && !viewerReady && progress !== null ? (
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

        {isIfc ? <ContextMenu handle={viewerHandleRef.current} /> : null}

        {showChrome ? (
          <>
            <SidePanel
              activePanel={activePanel}
              explorerContent={isIfc ? (
                <ModelExplorer
                  metadata={metadata}
                  isLoading={isLoadingMetadata}
                />
              ) : undefined}
              propertiesContent={isIfc ? (
                <PropertiesPanel
                  metadata={metadata}
                  properties={properties}
                  isLoadingProperties={isLoadingProperties}
                />
              ) : undefined}
              measureContent={isIfc ? (
                <MeasurementPanel handle={viewerHandleRef.current} />
              ) : undefined}
              bcfContent={isIfc ? (
                <BcfPanel handle={viewerHandleRef.current} />
              ) : undefined}
              pagesContent={isPdf ? (
                <PagesPanel
                  numPages={pdfNumPages}
                  currentPage={pdfCurrentPage}
                  onSelect={setPdfCurrentPage}
                />
              ) : undefined}
              headerActions={isIfc ? {
                measure: <MeasurementHeaderActions handle={viewerHandleRef.current} />,
                bcf: <BcfHeaderActions handle={viewerHandleRef.current} />,
              } : undefined}
            />
            <SideRail
              mode={mode}
              activePanel={activePanel}
              onTogglePanel={togglePanel}
            />
          </>
        ) : null}

        {showToolbarPlaceholder ? (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-11 top-0 h-12 border-b border-border bg-background/95 backdrop-blur-sm"
          />
        ) : null}

        {ifcShellReady ? (
          <div className={isEditMode ? 'pointer-events-none opacity-40 transition-opacity duration-200' : 'transition-opacity duration-200'}>
            <Toolbar
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
          </div>
        ) : null}

        {pdfShellReady ? (
          <DocumentToolbar
            currentPage={pdfCurrentPage}
            numPages={pdfNumPages}
            scale={pdfScale}
            activeTool={pdfActiveTool}
            documentHandle={documentHandle}
            settings={pdfSettings}
            onPageChange={setPdfCurrentPage}
            onScaleChange={setPdfScale}
            onActiveToolChange={setPdfActiveTool}
            onSettingsChange={setPdfSettings}
          />
        ) : null}

        {isIfc && isEditMode ? (
          <ModeIndicator toolLabel={modeState.toolLabel} />
        ) : null}

        {viewerError !== null ? (
          <div
            role="alert"
            className="pointer-events-none absolute left-4 top-2 z-40 rounded-md bg-error-lighter px-2 py-1 text-caption text-error shadow-sm"
          >
            {viewerError}
          </div>
        ) : null}
      </div>
      <StatusBar
        mode={mode}
        metadata={metadata}
        viewerReady={viewerReady}
        currentPage={pdfCurrentPage}
        numPages={pdfNumPages}
      />
    </main>
  );
}
