'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';

import { Skeleton } from '@bimstitch/ui';
import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import type {
  CommittedMarkupItem,
  DocumentActiveTool,
  DocumentRotation,
  DocumentViewerHandle,
  MarkupTool,
  PageDimensions,
  ViewerBundle,
  ViewerHandle,
} from '@bimstitch/viewer';

import { useAppHeader } from '@/components/shared/header/AppHeaderContext';
import { DocumentToolbar } from '@/components/shared/viewer/2d/DocumentToolbar';
import { ModeIndicator } from '@/components/shared/viewer/3d/ModeIndicator';
import { SideRail, type PanelId } from '@/components/shared/viewer/shared/SideRail';
import { isDrawingFormat, type ViewerFormat } from '@/components/shared/viewer/shared/viewerMode';
import { Toolbar } from '@/components/shared/viewer/3d/Toolbar';
import { MeasurementPanel, MeasurementHeaderActions } from '@/components/shared/viewer/3d/measurement/MeasurementPanel';
import { PdfMeasurementPanel } from '@/components/shared/viewer/2d/measurement/MeasurementPanel';
import { SectionPanel } from '@/components/shared/viewer/3d/section/SectionPanel';
import { BcfPanel } from '@/features/viewer/bcf/BcfPanel';
import { use2dBcfController, use3dBcfController } from '@/features/viewer/bcf/useBcfController';
import { useBcfMarkup2d } from '@/features/viewer/bcf/useBcfMarkup2d';
import { bcfKeys } from '@/features/viewer/bcf/queryKeys';
import { MarkupToolbar } from '@/components/shared/viewer/2d/MarkupToolbar';
import { ContextMenu } from '@/features/viewer/3d/ContextMenu';
import { ModelExplorer, ExplorerCounter } from '@/features/viewer/3d/explorer/ModelExplorer';
import { EntityInspectorPanel } from '@/features/viewer/shared/inspector/EntityInspectorPanel';
import { AnnotationPinLayer, type PdfPin } from '@/features/viewer/2d/AnnotationPinLayer';
import { EntityPinLayer } from '@/features/viewer/2d/EntityPinLayer';
import { DocumentContextMenu } from '@/features/viewer/2d/DocumentContextMenu';
import { DrawingCanvas } from '@/features/viewer/2d/drawing/DrawingCanvas';
import { DrawingInfoBody } from '@/features/viewer/2d/drawing/DrawingInfoBody';
import { useDrawingMetadata } from '@/features/viewer/2d/drawing/useDrawingMetadata';
import { usePdfPageAttachments } from '@/features/attachments/useAttachments';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { useEntityMarkers3D } from '@/features/viewer/3d/useEntityMarkers3D';
import { usePageFindingMarkers, usePageCertificateMarkers } from '@/features/viewer/shared/useEntityMarkers';
import type { EntityMarkerType } from '@/features/viewer/shared/entityMarkerTypes';
import { useFileFindings } from '@/features/findings/useFindings';
import { useFileCertificates } from '@/features/certificates/useCertificates';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { CertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import { ModelLoadingOverlay } from '@/components/shared/viewer/shared/ModelLoadingOverlay';
import { SidePanel } from '@/components/shared/viewer/shared/SidePanel';
import { StatusBar } from '@/features/viewer/shared/StatusBar';
import { useDocumentShortcuts } from '@/features/viewer/2d/useDocumentShortcuts';
import { useBcfGlobalIdMap } from '@/features/viewer/3d/useBcfGlobalIdMap';
import { useModelMetadata } from '@/features/viewer/3d/useModelMetadata';
import { useModelProperties } from '@/features/viewer/3d/useModelProperties';
import { usePdfGeometry } from '@/features/viewer/2d/usePdfGeometry';
import { viewerKeys } from '@/features/viewer/shared/queryKeys';
import { useViewerBridge } from '@/features/viewer/3d/useViewerBridge';
import { useViewerMode } from '@/features/viewer/3d/useViewerMode';

import { ApiError } from '@/lib/api/client';
import { getViewerBundle } from '@/lib/api/projectFiles';
import type { ViewerBundleResponse } from '@/lib/api/schemas';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  controlsFrom3D,
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
  if (response.outline_url !== null) out.outlineUrl = response.outline_url;
  if (response.fragments_key !== null) out.cacheKey = response.fragments_key;
  return out;
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
  const [pdfPinMode, setPdfPinMode] = useState(false);
  const [pdfPinViewAttachment, setPdfPinViewAttachment] = useState<import('@/lib/api/schemas').Attachment | null>(null);
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem('bimstitch.viewerMobileBanner') === 'dismissed';
  });
  const [markerFinding, setMarkerFinding] = useState<import('@/lib/api/schemas').Finding | null>(null);
  const [markerCertificate, setMarkerCertificate] = useState<import('@/lib/api/schemas').Certificate | null>(null);
  const [markerAttachment, setMarkerAttachment] = useState<import('@/lib/api/schemas').Attachment | null>(null);

  // 2D BCF markup (PDF annotations): draft-create + click-to-open flow.
  const [markupCreateNonce, setMarkupCreateNonce] = useState(0);
  const [markupOpenTopic, setMarkupOpenTopic] = useState<{ id: string; nonce: number } | null>(null);
  const queryClient = useQueryClient();
  const tMarkup = useTranslations('viewer.markup');

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

  useViewerBridge(viewerHandleRef.current, viewerReady);

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

  const modeState = useViewerMode(viewerHandleRef.current, viewerReady);
  const isEditMode = modeState.mode === 'edit';

  // IFC metadata blob is schema-specific — only fetch it for IFC bundles (the
  // DXF/DWG metadata_url points at a different shape, read via useDrawingMetadata).
  const metadataUrl = bundle?.file_type === 'ifc' ? (bundle.metadata_url ?? null) : null;
  const propertiesUrl = bundle?.properties_url ?? null;
  const { data: metadata, isLoading: isLoadingMetadata } = useModelMetadata(metadataUrl);
  // Feed the BCF plugin GlobalId -> ItemId so viewpoint selection/visibility
  // round-trips (the map is otherwise never populated).
  useBcfGlobalIdMap(viewerHandleRef.current, metadata);
  const hasSelection = isAllSelected || partialSelectionCount > 0;
  const { data: properties, isLoading: isLoadingProperties } = useModelProperties(
    propertiesUrl,
    (activePanel === 'explorer' && propertiesExpanded && hasSelection && !isAllSelected)
    || (activePanel === 'inspector' && hasSelection && !isAllSelected),
  );

  useAppHeader({ statusLabel: null, statusTone: undefined });

  const [sceneReady, setSceneReady] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [overlayFading, setOverlayFading] = useState(false);
  const [pdfFirstPageRendered, setPdfFirstPageRendered] = useState(false);
  const pdfRenderedRef = useRef(false);
  const prevLoadingRef = useRef(false);

  const onProgress = useCallback((loaded: number, total: number) => {
    setProgress({ loaded, total });
  }, []);

  useEffect(() => {
    setSettings(loadViewerSettings());
    setPdfSettings(loadDocumentSettings());
  }, []);

  // Reset viewer state when switching models or files.
  useEffect(() => {
    setActivePanel(null);
    setViewerReady(false);
    setSceneReady(false);
    setViewerError(null);
    setProgress(null);
    setInspectorRequest(null);
    setOverlayFading(false);
    setPdfFirstPageRendered(false);
    pdfRenderedRef.current = false;
    prevLoadingRef.current = false;
  }, [modelId, fileId]);

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
    setProgress(null);
  }, []);

  const handlePdfPageRendered = useCallback(() => {
    if (pdfRenderedRef.current) return;
    pdfRenderedRef.current = true;
    setPdfFirstPageRendered(true);
  }, []);

  const handlePdfError = useCallback((err: Error) => {
    setViewerError(err.message);
    setPdfFirstPageRendered(true);
  }, []);

  const fileType = bundle?.file_type;
  const format: ViewerFormat = fileType ?? 'ifc';
  const isDrawing = isDrawingFormat(format);
  const isPdf = format === 'pdf';
  const isIfc = format === 'ifc';

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

  const loadingActive =
    (isIfc && sceneReady && !viewerReady && progress !== null) ||
    (isPdf && bundle !== null && !pdfFirstPageRendered);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loadingActive;
    if (wasLoading && !loadingActive) {
      setOverlayFading(true);
      const timer = setTimeout(() => {
        setOverlayFading(false);
      }, 700);
      return () => clearTimeout(timer);
    }
    if (loadingActive) {
      setOverlayFading(false);
    }
  }, [loadingActive]);
  // Render the chrome (side rail, side panel, toolbar placeholder) as soon
  // as the page mounts — the only thing we wait for is the bundle URL, and
  // even that is usually prefetched on hover. The canvas area shows its own
  // skeleton/progress UI underneath while the file loads.
  const showChrome = error === null;
  const showToolbarPlaceholder = showChrome && !ifcShellReady && !pdfShellReady && !isDrawing;

  // Entity markers (findings + certificates with anchors)
  const allFileFindings = flattenPages(useFileFindings(projectId, fileId).data);
  const allFileCertificates = flattenPages(useFileCertificates(projectId, fileId).data);
  const findingMarkers2D = usePageFindingMarkers(projectId, fileId, isPdf ? pdfCurrentPage : null);
  const certMarkers2D = usePageCertificateMarkers(projectId, fileId, isPdf ? pdfCurrentPage : null);
  const entityMarkers2D = useMemo(
    () => [...findingMarkers2D, ...certMarkers2D],
    [findingMarkers2D, certMarkers2D],
  );

  const { clickedFinding, clickedCertificate, clickedAttachment, clearClicked } = useEntityMarkers3D(
    viewerHandleRef.current,
    projectId,
    isIfc ? fileId : null,
    viewerReady,
  );

  useEffect(() => {
    if (clickedFinding) setMarkerFinding(clickedFinding);
  }, [clickedFinding]);

  useEffect(() => {
    if (clickedCertificate) setMarkerCertificate(clickedCertificate);
  }, [clickedCertificate]);

  useEffect(() => {
    if (clickedAttachment) setMarkerAttachment(clickedAttachment);
  }, [clickedAttachment]);

  // PDF pin annotations
  const pdfPinsQuery = usePdfPageAttachments(
    projectId,
    fileId,
    isPdf ? pdfCurrentPage : null,
  );
  const pdfPins: PdfPin[] = (pdfPinsQuery.data ?? [])
    .filter((a) => a.anchor_x !== null && a.anchor_y !== null)
    .map((a) => ({
      attachmentId: a.id,
      x: a.anchor_x ?? 0,
      y: a.anchor_y ?? 0,
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

  const handleEntityMarkerClick = useCallback(
    (type: EntityMarkerType, entityId: string) => {
      if (type === 'finding') {
        const f = allFileFindings?.find((x) => x.id === entityId) ?? null;
        if (f) setMarkerFinding(f);
      } else if (type === 'certificate') {
        const c = allFileCertificates?.find((x) => x.id === entityId) ?? null;
        if (c) setMarkerCertificate(c);
      }
    },
    [allFileFindings, allFileCertificates],
  );

  // Per-page vector geometry (artifact `i` is 0-based; pdfCurrentPage is 1-based).
  const currentPageGeometry = pdfGeometry?.p.find((pg) => pg.i === pdfCurrentPage - 1) ?? null;

  // Feed the current page's vector geometry to the measure plugin for snapping.
  useEffect(() => {
    if (!isPdf || documentHandle === null) return;
    documentHandle.commands
      .execute('measure.setPageGeometry', { pageGeometry: currentPageGeometry })
      .catch(() => undefined);
  }, [isPdf, documentHandle, currentPageGeometry]);

  // --- 2D BCF markup (PDF annotations) ---
  const bcf3dController = use3dBcfController(viewerHandleRef.current);
  const bcf2dController = use2dBcfController(documentHandle, {
    fileId,
    onRestorePage: setPdfCurrentPage,
  });

  // Same per-page box as measure, so markup normalization lines up exactly.
  useEffect(() => {
    if (!isPdf || documentHandle === null) return;
    documentHandle.commands
      .execute('markup.setPageGeometry', { pageGeometry: currentPageGeometry })
      .catch(() => undefined);
  }, [isPdf, documentHandle, currentPageGeometry]);

  const markup2dQuery = useBcfMarkup2d(projectId, isPdf ? fileId : null, isPdf);
  const markupItems = useMemo<CommittedMarkupItem[]>(
    () =>
      (markup2dQuery.data ?? []).map((m) => ({
        topicId: m.topic_id,
        page: m.page ?? 1,
        annotations: m.annotations.map((a) => ({
          id: a.id,
          tool: a.tool,
          points: a.points,
          color: a.color,
          strokeWidth: a.strokeWidth,
          ...(a.text !== undefined ? { text: a.text } : {}),
        })),
      })),
    [markup2dQuery.data],
  );
  useEffect(() => {
    if (!isPdf || documentHandle === null) return;
    documentHandle.commands
      .execute('markup.setCommitted', { items: markupItems })
      .catch(() => undefined);
  }, [isPdf, documentHandle, markupItems]);

  // Draw a shape → open the pre-filled create form; click committed → open topic.
  useEffect(() => {
    if (!isPdf || documentHandle === null) return undefined;
    const offDraft = documentHandle.events.on('markup:draftComplete', () => {
      setActivePanel('bcf');
      setMarkupCreateNonce((n) => n + 1);
    });
    const offSelect = documentHandle.events.on('markup:select', ({ topicId }) => {
      setActivePanel('bcf');
      setMarkupOpenTopic((prev) => ({ id: topicId, nonce: (prev?.nonce ?? 0) + 1 }));
    });
    return () => { offDraft(); offSelect(); };
  }, [isPdf, documentHandle]);

  const handleMarkupCreateClose = useCallback(
    (saved: boolean) => {
      documentHandle?.commands.execute('markup.clearDraft').catch(() => undefined);
      if (saved) {
        void queryClient.invalidateQueries({ queryKey: bcfKeys.markup2d(projectId, fileId) });
      }
    },
    [documentHandle, queryClient, projectId, fileId],
  );

  const handleMarkupToolChange = useCallback((tool: MarkupTool | null) => {
    if (tool !== null) setPdfPinMode(false);
  }, []);

  const renderPdfOverlay = useCallback(
    (dims: PageDimensions) => (
      <>
        <AnnotationPinLayer
          pins={pdfPins}
          dims={dims}
          pinMode={pdfPinMode}
          onPinClick={handlePdfPinClick}
          onPinPlace={handlePdfPinPlace}
        />
        <EntityPinLayer
          markers={entityMarkers2D}
          dims={dims}
          onMarkerClick={handleEntityMarkerClick}
        />
      </>
    ),
    [pdfPins, pdfPinMode, handlePdfPinClick, handlePdfPinPlace, entityMarkers2D, handleEntityMarkerClick],
  );

  const handlePdfActiveToolChange = useCallback((tool: DocumentActiveTool) => {
    setPdfActiveTool(tool);
  }, []);

  // Pin placement and measurement both grab pointer events on the page — keep
  // them mutually exclusive so the overlays never fight.
  const handlePdfPinModeChange = useCallback((next: boolean) => {
    setPdfPinMode(next);
    if (next) {
      setPdfActiveTool('select');
      documentHandle?.commands.execute('measure.deactivate').catch(() => undefined);
    }
  }, [documentHandle]);

  const handleDocContextMenuInspector = useCallback((view: 'attachments' | 'findings' | 'certificates') => {
    setActivePanel('inspector');
    setInspectorRequest((prev) => ({ view, nonce: (prev?.nonce ?? 0) + 1 }));
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
      addFinding: () => { handleDocContextMenuInspector('findings'); },
      addAttachment: () => { handleDocContextMenuInspector('attachments'); },
      viewCertificates: () => { handleDocContextMenuInspector('certificates'); },
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
        className="absolute inset-0"
        navCompass={{ enabled: true, locale: locale as 'en' | 'nl' }}
        controls={pdfSettings.controlsLinked ? controlsFrom3D(settings.controls) : pdfSettings.controls}
        onProgress={onProgress}
        onLoaded={handlePdfLoaded}
        onError={handlePdfError}
        onPageRendered={handlePdfPageRendered}
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
    <main className="flex min-h-0 w-full flex-1 flex-col">
      {!mobileBannerDismissed && (
        <div className="flex items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-body3 text-foreground md:hidden">
          <span>3D viewer works best on a larger screen.</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              sessionStorage.setItem('bimstitch.viewerMobileBanner', 'dismissed');
              setMobileBannerDismissed(true);
            }}
            className="shrink-0 rounded px-2 py-0.5 text-caption font-semibold hover:bg-warning/20"
          >
            OK
          </button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {canvas}

        {(loadingActive || overlayFading) ? (
          <ModelLoadingOverlay
            progress={progress !== null && progress.total > 0 ? (progress.loaded / progress.total) * 100 : (overlayFading ? 100 : 0)}
            fading={overlayFading}
          />
        ) : null}

        {isIfc ? <ContextMenu handle={viewerHandleRef.current} viewerReady={viewerReady} /> : null}
        {isPdf ? <DocumentContextMenu handle={documentHandle} onRequestInspector={handleDocContextMenuInspector} shortcuts={pdfSettings.shortcuts} ready={pdfFirstPageRendered} /> : null}

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
              ) : isPdf ? (
                <PdfMeasurementPanel handle={documentHandle} />
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
              bcfContent={isIfc ? (
                <BcfPanel projectId={projectId} controller={bcf3dController} />
              ) : isPdf ? (
                <BcfPanel
                  projectId={projectId}
                  controller={bcf2dController}
                  createNonce={markupCreateNonce}
                  onCreateClose={handleMarkupCreateClose}
                  openTopicId={markupOpenTopic?.id}
                  openTopicNonce={markupOpenTopic?.nonce}
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
          />
        ) : null}

        {pdfShellReady ? (
          <MarkupToolbar
            documentHandle={documentHandle}
            labels={{
              rectangle: tMarkup('rectangle'),
              arrow: tMarkup('arrow'),
              cloud: tMarkup('cloud'),
              freehand: tMarkup('freehand'),
              text: tMarkup('text'),
            }}
            onActiveToolChange={handleMarkupToolChange}
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
        format={format}
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

      {/* Entity marker detail modals */}
      <FindingDetailModal
        projectId={projectId}
        finding={markerFinding}
        open={markerFinding !== null}
        onOpenChange={(open) => { if (!open) { setMarkerFinding(null); clearClicked(); } }}
      />
      <CertificateViewerDialog
        projectId={projectId}
        certificate={markerCertificate}
        open={markerCertificate !== null}
        onOpenChange={(open) => { if (!open) { setMarkerCertificate(null); clearClicked(); } }}
      />
      <AttachmentViewerDialog
        attachment={markerAttachment}
        projectId={projectId}
        open={markerAttachment !== null}
        onOpenChange={(open) => { if (!open) { setMarkerAttachment(null); clearClicked(); } }}
      />
      </div>
      {showChrome && bundle !== null ? (
        <SideRail
          format={format}
          activePanel={activePanel}
          onTogglePanel={togglePanel}
        />
      ) : null}
      </div>
    </main>
  );
}
