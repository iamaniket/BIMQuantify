'use client';

import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';

import { Skeleton } from '@bimstitch/ui';
import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import type {
  DocumentActiveTool,
  DocumentRotation,
  DocumentViewerHandle,
  PageDimensions,
  SearchHighlight,
  ViewerBundle,
  ViewerHandle,
} from '@bimstitch/viewer';

import { useAppHeader } from '@/components/shared/header/AppHeaderContext';
import { DocumentToolbar } from '@/components/shared/viewer/DocumentToolbar';
import { ModeIndicator } from '@/components/shared/viewer/ModeIndicator';
import { SideRail, type PanelId, type Mode } from '@/components/shared/viewer/SideRail';
import { Toolbar } from '@/components/shared/viewer/Toolbar';
import { MeasurementPanel, MeasurementHeaderActions } from '@/components/shared/viewer/measurement/MeasurementPanel';
import { SectionPanel } from '@/components/shared/viewer/section/SectionPanel';
import { ContextMenu } from '@/features/viewer/ContextMenu';
import { ModelExplorer, ExplorerCounter } from '@/features/viewer/explorer/ModelExplorer';
import { EntityInspectorPanel } from '@/features/viewer/inspector/EntityInspectorPanel';
import { PdfAnnotationLayer, type PdfPin } from '@/features/viewer/attachments/PdfAnnotationLayer';
import { PdfVectorOverlay } from '@/features/viewer/pdf/PdfVectorOverlay';
import { DrawingCanvas } from '@/features/viewer/drawing/DrawingCanvas';
import { DrawingInfoBody } from '@/features/viewer/drawing/DrawingInfoBody';
import { useDrawingMetadata } from '@/features/viewer/drawing/useDrawingMetadata';
import { usePdfPageAttachments } from '@/features/attachments/useAttachments';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { SidePanel } from '@/features/viewer/SidePanel';
import { StatusBar } from '@/features/viewer/StatusBar';
import { useDocumentShortcuts } from '@/features/viewer/useDocumentShortcuts';
import { useModelMetadata } from '@/features/viewer/useModelMetadata';
import { useModelProperties } from '@/features/viewer/useModelProperties';
import { usePdfGeometry } from '@/features/viewer/usePdfGeometry';
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
  const locale = useLocale();
  const { tokens } = useAuth();

  useEffect(() => {
    track(PORTAL_EVENTS.VIEWER_OPENED, {
      project_id: projectId,
      model_id: modelId,
      file_id: fileId,
    });
  }, [projectId, modelId, fileId]);

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
  const partialSelectionCount = useViewerEntityStore((s) => s.selected.size);
  const isAllSelected = useViewerEntityStore((s) => s.selectedAll);
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
  const [pdfSearchHighlight, setPdfSearchHighlight] = useState<SearchHighlight | null>(null);
  const [pdfPinMode, setPdfPinMode] = useState(false);
  const [pdfPinViewAttachment, setPdfPinViewAttachment] = useState<import('@/lib/api/schemas').Attachment | null>(null);

  const [inspectorRequest, setInspectorRequest] = useState<{
    view: 'attachments' | 'findings' | 'certificates';
    nonce: number;
  } | null>(null);
  const [propertiesExpanded, setPropertiesExpanded] = useState(true);
  const [modelTreeExpanded, setModelTreeExpanded] = useState(true);
  // Track whether initial fit-to-page has been applied for the current file
  const pdfInitializedRef = useRef<string | null>(null);

  const togglePanel = useCallback((id: PanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  // Auto-open section panel when entering section placement mode
  useEffect(() => {
    const handle = viewerHandleRef.current;
    if (!handle) return undefined;
    return handle.events.on('mode:enter', ({ toolName }) => {
      if (toolName === 'section.place') {
        setActivePanel('section');
      }
    });
  }, [viewerReady]);

  useEffect(() => {
    const handle = viewerHandleRef.current;
    if (!handle) return undefined;
    return handle.events.on('inspect:request', ({ view }) => {
      if (view === 'properties') {
        setActivePanel('explorer');
        setPropertiesExpanded(true);
      } else {
        setActivePanel('inspector');
        setInspectorRequest((prev) => ({ view, nonce: (prev?.nonce ?? 0) + 1 }));
      }
    });
  }, [viewerReady]);

  useViewerBridge(viewerHandleRef.current);

  // Apply persisted behavior toggles once the viewer is ready.

  useEffect(() => {
    if (!viewerReady) return;
    const handle = viewerHandleRef.current;
    if (!handle) return;
    const { behavior } = settings;
    if (!behavior.hoverHighlight.enabled) {
      handle.commands.execute('hover.setEnabled', false).catch(() => undefined);
    }
    if (!behavior.selection.enabled) {
      handle.commands.execute('selection.setEnabled', false).catch(() => undefined);
    }
  }, [viewerReady]);

  const modeState = useViewerMode(viewerHandleRef.current);
  const isEditMode = modeState.mode === 'edit';

  // IFC metadata blob is schema-specific — only fetch it for IFC bundles (the
  // DXF/DWG metadata_url points at a different shape, read via useDrawingMetadata).
  const metadataUrl = bundle?.file_type === 'ifc' ? (bundle.metadata_url ?? null) : null;
  const propertiesUrl = bundle?.properties_url ?? null;
  const { data: metadata, isLoading: isLoadingMetadata } = useModelMetadata(metadataUrl);
  const hasSelection = isAllSelected || partialSelectionCount > 0;
  const { data: properties, isLoading: isLoadingProperties } = useModelProperties(
    propertiesUrl,
    (activePanel === 'explorer' && propertiesExpanded && hasSelection && !isAllSelected)
    || (activePanel === 'inspector' && hasSelection && !isAllSelected),
  );

  useAppHeader({ statusLabel: null, statusTone: undefined });

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
    setPdfSearchHighlight(null);
  }, [fileId]);

  const handlePdfLoaded = useCallback(({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
  }, []);

  const handlePdfError = useCallback((err: Error) => {
    setViewerError(err.message);
  }, []);

  const fileType = bundle?.file_type;
  const isDrawing = fileType === 'dxf' || fileType === 'dwg';
  const mode: Mode = fileType === 'pdf' ? 'pdf' : isDrawing ? 'drawing' : 'ifc';
  const isPdf = mode === 'pdf';
  const isIfc = mode === 'ifc';

  // Apply fit-to-page only once when a PDF is first loaded.
  useEffect(() => {
    if (!isPdf || documentHandle === null || pdfNumPages === null) return;
    // Only apply fit-to-page if we haven't already done so for this file
    if (pdfInitializedRef.current !== fileId) {
      documentHandle.fitPage();
      pdfInitializedRef.current = fileId;
    }
  }, [isPdf, documentHandle, pdfNumPages, fileId]);

  // Vector geometry artifact. PDFs use it as an invisible snap layer; DXF/DWG
  // drawings render it directly (there is no raster page).
  const geometryUrl = bundle?.geometry_url ?? null;
  const { data: pdfGeometry } = usePdfGeometry((isPdf || isDrawing) ? geometryUrl : null);
  const { data: drawingMetadata, isLoading: isLoadingDrawingMetadata } = useDrawingMetadata(
    isDrawing ? (bundle?.metadata_url ?? null) : null,
  );
  const drawingPage = isDrawing ? (pdfGeometry?.p[0] ?? null) : null;
  const shellReady = bundle !== null && error === null;
  const ifcShellReady = shellReady && isIfc && viewerReady;
  const pdfShellReady = shellReady && isPdf;
  // Render the chrome (side rail, side panel, toolbar placeholder) as soon
  // as the page mounts — the only thing we wait for is the bundle URL, and
  // even that is usually prefetched on hover. The canvas area shows its own
  // skeleton/progress UI underneath while the file loads.
  const showChrome = error === null;
  const showToolbarPlaceholder = showChrome && !ifcShellReady && !pdfShellReady && !isDrawing;

  // PDF pin annotations
  const pdfPinsQuery = usePdfPageAttachments(
    projectId,
    fileId,
    isPdf ? pdfCurrentPage : null,
  );
  const pdfPins: PdfPin[] = (pdfPinsQuery.data ?? [])
    .filter((a): a is typeof a & { linked_point: Record<string, unknown> } => a.linked_point !== null)
    .map((a) => ({
      attachmentId: a.id,
      x: Number(a.linked_point['x'] ?? 0),
      y: Number(a.linked_point['y'] ?? 0),
      attachment: a,
    }));

  const handlePdfPinPlace = useCallback(
    (point: { x: number; y: number }) => {
      setPdfPinMode(false);
      // TODO: open upload dialog with pre-filled point — for now, store the intent
      // in sessionStorage so AttachmentsPanel can pick it up.
      const pinData = JSON.stringify({
        type: 'pdf', page: pdfCurrentPage, x: point.x, y: point.y,
      });
      sessionStorage.setItem('bimstitch.pendingPdfPin', pinData);
      setActivePanel('inspector');
    },
    [pdfCurrentPage],
  );

  const handlePdfPinClick = useCallback(
    (attachmentId: string) => {
      const att = pdfPins.find((p) => p.attachmentId === attachmentId);
      if (att) setPdfPinViewAttachment(att.attachment);
    },
    [pdfPins],
  );

  // Per-page vector geometry (artifact `i` is 0-based; pdfCurrentPage is 1-based).
  const currentPageGeometry = pdfGeometry?.p.find((pg) => pg.i === pdfCurrentPage - 1) ?? null;

  const renderPdfOverlay = useCallback(
    (dims: PageDimensions) => (
      <>
        <PdfAnnotationLayer
          pins={pdfPins}
          dims={dims}
          pinMode={pdfPinMode}
          onPinClick={handlePdfPinClick}
          onPinPlace={handlePdfPinPlace}
        />
        <PdfVectorOverlay
          dims={dims}
          pageGeometry={currentPageGeometry}
          rotation={pdfRotation}
          active={pdfActiveTool === 'line'}
        />
      </>
    ),
    [pdfPins, pdfPinMode, handlePdfPinClick, handlePdfPinPlace, currentPageGeometry, pdfRotation, pdfActiveTool],
  );

  // Line and pin placement both grab pointer events on the page — keep them
  // mutually exclusive so the two overlays never fight.
  const handlePdfActiveToolChange = useCallback((tool: DocumentActiveTool) => {
    setPdfActiveTool(tool);
    if (tool === 'line') setPdfPinMode(false);
  }, []);

  const handlePdfPinModeChange = useCallback((next: boolean) => {
    setPdfPinMode(next);
    if (next) setPdfActiveTool('select');
  }, []);

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
      firstPage: () => { setPdfCurrentPage(1); },
      lastPage: () => {
        if (pdfNumPages !== null) setPdfCurrentPage(pdfNumPages);
      },
      toolSelect: () => { setPdfActiveTool('select'); },
      toolPan: () => { setPdfActiveTool('pan'); },
      toolZoom: () => { setPdfActiveTool('zoom'); },
    },
  });

  let canvas: JSX.Element | null = null;
  if (error !== null) {
    canvas = (
      <ErrorBanner message={error} tone="soft" className="m-6 text-body2" />
    );
  } else if (bundle === null) {
    canvas = <Skeleton className="absolute inset-0" />;
  } else if (isDrawing) {
    canvas = drawingPage !== null
      ? <DrawingCanvas page={drawingPage} />
      : <Skeleton className="absolute inset-0" />;
  } else if (isPdf) {
    canvas = (
      <DocumentViewer
        ref={setDocumentHandle}
        fileUrl={bundle.file_url!}
        currentPage={pdfCurrentPage}
        scale={pdfScale}
        rotation={pdfRotation}
        activeTool={pdfActiveTool}
        searchHighlight={pdfSearchHighlight}
        className="absolute inset-0"
        onLoaded={handlePdfLoaded}
        onError={handlePdfError}
        onScaleChange={setPdfScale}
        onRotationChange={setPdfRotation}
        renderOverlay={renderPdfOverlay}
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
          locale: locale as 'en' | 'nl',
        }}
        shadows={{
          enabled: settings.shadows.enabled,
        }}
        background={{ color: settings.background.color }}
        effects={settings.effects}
        outline={{ enabled: settings.outline.enabled }}
        hoverHighlight={{ color: settings.behavior.hoverHighlight.color }}
        selectionHighlight={{ color: settings.behavior.selection.color }}
        shortcuts={settings.shortcuts}
        mouseBindings={settings.mouseBindings}
        controls={settings.controls}
        zoom={settings.zoom}
        interactivePerformance={settings.interactivePerformance}
        onSceneReady={() => {
          setSceneReady(true);
        }}
        onProgress={onProgress}
        onReady={(handle) => {
          viewerHandleRef.current = handle;
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__viewer = handle;
          }
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
    <main className="flex min-h-0 w-full flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <SidePanel
              activePanel={activePanel}
              inspectorContent={
                <EntityInspectorPanel
                  metadata={metadata}
                  projectId={projectId}
                  modelId={modelId}
                  fileId={fileId}
                  requestedView={inspectorRequest?.view}
                  requestNonce={inspectorRequest?.nonce}
                  {...(isPdf ? {
                    isPdf: true,
                    pdfCurrentPage,
                    pdfPinMode,
                    onPdfPinModeChange: handlePdfPinModeChange,
                  } : {})}
                />
              }
              explorerContent={isIfc ? (
                <ModelExplorer
                  metadata={metadata}
                  isLoading={isLoadingMetadata}
                  properties={properties}
                  isLoadingProperties={isLoadingProperties}
                  isLoadingMetadata={isLoadingMetadata}
                  propertiesExpanded={propertiesExpanded}
                  onPropertiesToggle={() => { setPropertiesExpanded((prev) => !prev); }}
                  modelTreeExpanded={modelTreeExpanded}
                />
              ) : undefined}
              measureContent={isIfc ? (
                <MeasurementPanel handle={viewerHandleRef.current} />
              ) : undefined}
              sectionContent={isIfc ? (
                <SectionPanel handle={viewerHandleRef.current} />
              ) : undefined}
              drawingInfoContent={isDrawing ? (
                <DrawingInfoBody
                  metadata={drawingMetadata}
                  isLoading={isLoadingDrawingMetadata}
                />
              ) : undefined}
              headerActions={isIfc ? {
                explorer: <ExplorerCounter metadata={metadata} />,
                measure: <MeasurementHeaderActions handle={viewerHandleRef.current} />,
              } : undefined}
              headerExpanded={modelTreeExpanded}
              onHeaderToggle={() => { setModelTreeExpanded((prev) => !prev); }}
            />
        ) : null}

        {showToolbarPlaceholder ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-8 border-b border-border bg-background/95 backdrop-blur-sm"
          />
        ) : null}

        {ifcShellReady ? (
          <div className={isEditMode ? 'pointer-events-none opacity-40 transition-opacity duration-200' : 'transition-opacity duration-200'}>
            <Toolbar
              handle={viewerHandleRef.current}
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
            onActiveToolChange={handlePdfActiveToolChange}
            onSettingsChange={setPdfSettings}
            onSearchHighlightChange={setPdfSearchHighlight}
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
        drawingMetadata={drawingMetadata}
        viewerReady={viewerReady}
        currentPage={pdfCurrentPage}
        numPages={pdfNumPages}
        projectId={projectId}
        fileId={fileId}
      />

      {/* PDF pin attachment viewer */}
      <AttachmentViewerDialog
        attachment={pdfPinViewAttachment}
        projectId={projectId}
        open={pdfPinViewAttachment !== null}
        onOpenChange={(open) => { if (!open) setPdfPinViewAttachment(null); }}
      />
      </div>
      {showChrome ? (
        <SideRail
          mode={mode}
          activePanel={activePanel}
          onTogglePanel={togglePanel}
        />
      ) : null}
    </main>
  );
}
