'use client';

import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import React, {
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
  FloorPlanViewerHandle,
  MarkupTool,
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
import { type ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { ModelExplorer, ExplorerCounter } from '@/features/viewer/3d/explorer/ModelExplorer';
import { useExplorerModels } from '@/features/viewer/3d/explorer/useExplorerModels';
import { EntityInspectorPanel } from '@/features/viewer/shared/inspector/EntityInspectorPanel';
import { DocumentContextMenu } from '@/features/viewer/2d/DocumentContextMenu';
import { DrawingCanvas } from '@/features/viewer/2d/drawing/DrawingCanvas';
import { DrawingInfoBody } from '@/features/viewer/2d/drawing/DrawingInfoBody';
import { useDrawingMetadata } from '@/features/viewer/2d/drawing/useDrawingMetadata';
import { useEntityMarkers3D } from '@/features/viewer/3d/useEntityMarkers3D';
import { useFederatedEntityMarkers3D } from '@/features/viewer/3d/useFederatedEntityMarkers3D';
import { useEntityMarkers2D } from '@/features/viewer/2d/useEntityMarkers2D';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { useFileFindings } from '@/features/findings/useFindings';
import { buildGlobalIdToLocalId } from '@/features/viewer/shared/buildGlobalIdToLocalId';
import { SidePanel } from '@/components/shared/viewer/shared/SidePanel';
import { StatusBar } from '@/features/viewer/shared/StatusBar';
import { useDocumentShortcuts } from '@/features/viewer/2d/useDocumentShortcuts';
import { useBcfGlobalIdMap } from '@/features/viewer/3d/useBcfGlobalIdMap';
import { useModelMetadata } from '@/features/viewer/3d/useModelMetadata';
import { useModelProperties } from '@/features/viewer/3d/useModelProperties';
import { usePdfGeometry } from '@/features/viewer/2d/usePdfGeometry';
import { useViewerScope } from '@/features/viewer/shared/useViewerScope';
import { useViewerSelectionHydrated } from '@/features/viewer/shared/viewerSelectionStore';
import { useViewerBridge } from '@/features/viewer/3d/useViewerBridge';
import { useSpaceVisibility } from '@/features/viewer/3d/spaces';
import { usePerformanceCulling } from '@/features/viewer/3d/performanceCulling';
import { useDisplayMode } from '@/features/viewer/3d/displayMode';
import { useViewerMode } from '@/features/viewer/3d/useViewerMode';
import { useIsMobile } from '@/hooks/useIsMobile';

import type { Finding } from '@/lib/api/schemas';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  controlsFrom3D,
  loadDocumentSettings,
  type DocumentSettings,
} from '@/lib/documentSettings';
import {
  DEFAULT_VIEWER_SETTINGS,
  loadViewerSettings,
  saveViewerSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import { parseEntityKey, toEntityKey, useViewerEntityStore } from '@/stores/viewerEntityStore';

import { IfcViewerCanvas } from './components/IfcViewerCanvas';
import { ViewerLoadingOverlay } from './components/ViewerLoadingOverlay';
import { ViewerMobileBanner } from './components/ViewerMobileBanner';

const DocumentViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export default function ViewerPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  // Scope (which model(s) to load) comes from the client selection store, not
  // the URL — so the viewer URL stays a clean `/projects/<id>/viewer`. Defer
  // until the store rehydrates so a refresh restores the exact scene.
  const hydrated = useViewerSelectionHydrated();
  const scope = useViewerScope(projectId, hydrated);
  // `modelId` / `fileId` are the ACTIVE model's API ids (single: the target
  // file; multi: the selected/primary model). Aliased so the existing panel
  // wiring below reads them unchanged.
  const modelId = scope.activeModelId;
  const fileId = scope.activeFileId;
  const deepLinkFindingId = scope.deepLinkFindingId;
  const locale = useLocale();

  useEffect(() => {
    track(PORTAL_EVENTS.VIEWER_OPENED, {
      project_id: projectId,
      model_id: modelId,
      file_id: fileId,
    });
  }, [projectId, modelId, fileId]);

  const bundle = scope.activeBundle;
  const error: string | null = scope.errorMessage;
  const [viewerError, setViewerError] = useState<string | null>(null);
  // Federated models that failed to load (non-fatal — the rest of the scene
  // still renders). Reset whenever the scene anchor changes (a new IfcViewer).
  const [failedModelIds, setFailedModelIds] = useState<string[]>([]);
  useEffect(() => { setFailedModelIds([]); }, [scope.sceneKey]);
  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const partialSelectionCount = useViewerEntityStore((s) => s.selected.size);
  const isAllSelected = useViewerEntityStore((s) => s.selectedAll);
  const selectedKeys = useViewerEntityStore((s) => s.selected);
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_VIEWER_SETTINGS);
  const [viewerEpoch, setViewerEpoch] = useState(0);
  // Viewport layout for IFC models: 3D only / Split (3D + plan) / 2D (plan).
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
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
  // Floor-plan handle + active storey elevation, surfaced from the plan pane so
  // the inspector's "update pin" can pick on the plan (2D mode) and lift the
  // picked point to a 3D world anchor at the right floor.
  const [fpHandle, setFpHandle] = useState<FloorPlanViewerHandle | null>(null);
  const [fpElevation, setFpElevation] = useState<number | null>(null);
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem('bimstitch.viewerMobileBanner') === 'dismissed';
  });
  // Marker / deep-link click → expand that finding's row in the inspector
  // (replacing the old floating detail modal). `nonce` re-fires on repeat clicks.
  const [openFinding, setOpenFinding] = useState<{ id: string; nonce: number } | null>(null);

  // 2D BCF markup (PDF annotations): draft-create + click-to-open flow.
  const [markupCreateNonce, setMarkupCreateNonce] = useState(0);
  const [markupOpenTopic, setMarkupOpenTopic] = useState<{ id: string; nonce: number } | null>(null);
  const queryClient = useQueryClient();
  const tMarkup = useTranslations('viewer.markup');
  const tFed = useTranslations('viewer.federated');
  const tLoad = useTranslations('viewer.loadingOverlay');

  const [inspectorRequest, setInspectorRequest] = useState<{
    view: 'findings';
    nonce: number;
    /** Set when the request came from the 2D floor-plan pane (IFC-anchored). */
    surface?: 'floorplan';
  } | null>(null);
  const [propertiesExpanded, setPropertiesExpanded] = useState(true);
  const [modelTreeExpanded, setModelTreeExpanded] = useState(true);
  // Track whether initial fit-to-page has been applied for the current file
  const pdfInitializedRef = useRef<string | null>(null);

  // ── Draggable split divider ───────────────────────────────────────────────
  const SPLIT_RATIO_KEY = 'bimstitch.splitRatio';
  const SPLIT_MIN = 0.2;
  const SPLIT_MAX = 0.8;
  const isMobile = useIsMobile();
  const [splitRatio, setSplitRatio] = useState(0.5);
  // Hydrate from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    const stored = localStorage.getItem(SPLIT_RATIO_KEY);
    const v = stored !== null ? parseFloat(stored) : NaN;
    if (!isNaN(v) && v >= SPLIT_MIN && v <= SPLIT_MAX) setSplitRatio(v);
  }, []);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const threeDPaneRef = useRef<HTMLDivElement>(null);
  const planPaneRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const splitRatioRef = useRef(splitRatio);
  const isDraggingRef = useRef(false);
  useEffect(() => { splitRatioRef.current = splitRatio; }, [splitRatio]);

  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
  }, []);

  const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const ratio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (e.clientX - rect.left) / rect.width));
    splitRatioRef.current = ratio;
    if (threeDPaneRef.current)  threeDPaneRef.current.style.width  = `${ratio * 100}%`;
    if (planPaneRef.current)    planPaneRef.current.style.width    = `${(1 - ratio) * 100}%`;
    if (dividerRef.current)     dividerRef.current.style.left      = `calc(${ratio * 100}% - 4px)`;
  }, []);

  const handleDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const ratio = splitRatioRef.current;
    setSplitRatio(ratio);
    localStorage.setItem(SPLIT_RATIO_KEY, String(ratio));
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

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
        setInspectorRequest((prev) => ({ view: 'findings', nonce: (prev?.nonce ?? 0) + 1 }));
      }
    });
  }, [viewerReady]);

  useViewerBridge(viewerHandleRef.current, viewerReady);

  // Multi-model: the active model (what the inspector / explorer / BCF scope to)
  // follows the selected element. Resolve the selection's viewer model id
  // (`file-<fileId>`) back to its manifest entry and make it active.
  useEffect(() => {
    if (scope.mode !== 'multi') return;
    for (const k of selectedKeys) {
      const p = parseEntityKey(k);
      if (p) {
        scope.setActiveByViewerModelId(p.modelId);
        break;
      }
    }
  }, [selectedKeys, scope.mode, scope.setActiveByViewerModelId]);

  // Keep `store.modelId` (the id the explorer/inspector build entity keys from)
  // pointed at the active model. The viewer bridge sets it to the last-loaded
  // model on `model:loaded`; this re-asserts the active one (and unifies single
  // mode onto the `file-<fileId>` scheme).
  useEffect(() => {
    if (!viewerReady || scope.activeViewerModelId === '') return;
    useViewerEntityStore.getState()._setModelId(scope.activeViewerModelId);
  }, [viewerReady, scope.activeViewerModelId]);

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
  // Plan source for the minimap / floor-plan pane. In multi-model mode the
  // architectural model supplies the plan (not the active model), so fetch its
  // metadata separately — `useModelMetadata` is URL-keyed, so in single mode
  // this dedupes with `metadata` (same model).
  const { data: planMetadata } = useModelMetadata(scope.planMetadataUrl);
  // Explorer models: one (active) in single-file mode; every loaded model's
  // metadata in federated mode (per-model object branches, aggregated classes,
  // storeys merged across models).
  const { models: explorerModels, isLoading: explorerModelsLoading } = useExplorerModels(
    scope,
    metadata,
  );
  // Feed the BCF plugin GlobalId -> ItemId so viewpoint selection/visibility
  // round-trips (the map is otherwise never populated).
  useBcfGlobalIdMap(viewerHandleRef.current, metadata);
  // Spaces (IfcSpace) are hidden by default and controlled solely by the
  // toolbar toggle; this keeps the viewer in sync with `settings.spaces.show`.
  useSpaceVisibility(viewerHandleRef.current, viewerReady, settings.spaces.show);
  // Native frustum-culling policy (auto/on/off) for large/federated scenes;
  // keeps the viewer in sync with `settings.performance.culling`.
  usePerformanceCulling(
    viewerHandleRef.current,
    viewerReady,
    settings.performance.culling,
  );
  // Re-apply the persisted whole-model look (monochrome/clay/matcap) on
  // (re)mount; the toolbar drives live changes directly via `display.set`.
  useDisplayMode(viewerHandleRef.current, viewerReady, settings.displayMode.mode);
  const hasSelection = isAllSelected || partialSelectionCount > 0;
  const { data: properties, isLoading: isLoadingProperties } = useModelProperties(
    propertiesUrl,
    (activePanel === 'explorer' && propertiesExpanded && hasSelection && !isAllSelected)
    || (activePanel === 'inspector' && hasSelection && !isAllSelected),
  );

  useAppHeader({ statusLabel: null, statusTone: undefined });

  const [sceneReady, setSceneReady] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  // True while the viewer is applying a model load/unload delta (initial batch
  // OR a later federated add/remove/unload). Driven by IfcViewer's onBusyChange.
  const [viewerBusy, setViewerBusy] = useState(false);
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

  // Persist + apply viewer settings (used by the toolbar toggles and the
  // settings dialog) so toolbar changes like the spaces toggle survive reload.
  const handleSettingsChange = useCallback((next: ViewerSettings) => {
    saveViewerSettings(next);
    setSettings(next);
  }, []);

  // Reset viewer state when switching models or files.
  useEffect(() => {
    setActivePanel(null);
    setViewerReady(false);
    setSceneReady(false);
    setViewerError(null);
    setProgress(null);
    setViewerBusy(false);
    setInspectorRequest(null);
    setOverlayFading(false);
    setPdfFirstPageRendered(false);
    pdfRenderedRef.current = false;
    prevLoadingRef.current = false;
    setViewMode('3d');
    // Key on the loaded-set identity (single: the file; multi: the model set),
    // NOT the active model — switching the active model must not reset the scene.
  }, [scope.sceneKey]);

  // Reset PDF state when switching to a different file.
  useEffect(() => {
    setPdfCurrentPage(1);
    setPdfNumPages(null);
    setPdfScale(1);
    setPdfRotation(0);
    setPdfActiveTool('select');
  }, [scope.sceneKey]);

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
  // Split / 2D modes (and the view switcher) require a floor-plan artifact.
  const hasFloorPlans = Boolean(isIfc && scope.planFloorPlansUrl);

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
    (isIfc && (viewerBusy || (sceneReady && !viewerReady && progress !== null))) ||
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

  // GlobalId → ItemId for the open model, so a marker click can select the
  // finding's linked element and drive the inspector into element scope.
  const gidToLocal = useMemo(
    () => buildGlobalIdToLocalId(metadata, scope.activeViewerModelId),
    [metadata, scope.activeViewerModelId],
  );

  // Open a finding inside the inspector panel: switch the inspector scope (select
  // the linked element, or clear selection for coordinate-only / unlinked /
  // PDF findings → project/file scope), then bump the open nonce so the findings
  // body expands that row once its scoped query has loaded it.
  const openFindingInInspector = useCallback((finding: Finding) => {
    setActivePanel('inspector');
    const item =
      finding.linked_element_global_id != null
        ? gidToLocal.get(finding.linked_element_global_id)
        : undefined;
    const store = useViewerEntityStore.getState();
    if (item !== undefined) {
      store.select([toEntityKey(item.modelId, item.localId)]);
    } else {
      store.clearSelection();
    }
    setOpenFinding((prev) => ({ id: finding.id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [gidToLocal]);

  // Entity markers for the 3D (IFC) viewer. Single-file mode uses the rich,
  // isolation-aware single-model hook; federated mode aggregates finding pins
  // across every loaded model. `enabled` ensures only one writes the marker set.
  const singleMarkers = useEntityMarkers3D(
    viewerHandleRef.current,
    projectId,
    isIfc ? fileId : null,
    viewerReady,
    metadata,
    scope.mode === 'single',
  );
  const federatedMarkers = useFederatedEntityMarkers3D(
    viewerHandleRef.current,
    projectId,
    scope.entries,
    viewerReady,
    scope.mode === 'multi',
  );
  const { clickedFinding, clearClicked } =
    scope.mode === 'multi' ? federatedMarkers : singleMarkers;

  useEffect(() => {
    if (clickedFinding) {
      // Federated: focus the finding's model so the inspector scopes to it.
      if (scope.mode === 'multi' && clickedFinding.linked_model_id !== null) {
        scope.setActiveByModelId(clickedFinding.linked_model_id);
      }
      openFindingInInspector(clickedFinding);
      clearClicked();
    }
  }, [clickedFinding]);

  // Deep-link: open a finding's detail when arriving via `?finding=<id>` (the
  // "View in model" link from /findings → Locations). The finding is anchored to
  // this file, so it's already in the file-scoped query the markers fetch.
  const fileFindings = flattenPages(useFileFindings(projectId, fileId).data);
  const deepLinkOpenedRef = useRef(false);
  useEffect(() => { deepLinkOpenedRef.current = false; }, [fileId, deepLinkFindingId]);
  useEffect(() => {
    if (deepLinkFindingId === null || deepLinkOpenedRef.current) return;
    const match = fileFindings.find((f) => f.id === deepLinkFindingId);
    if (match !== undefined) {
      deepLinkOpenedRef.current = true;
      openFindingInInspector(match);
    }
  }, [deepLinkFindingId, fileFindings]);

  // 2D entity markers (findings) render as three.js glyphs in the shared scene
  // via the entity-marker-2d plugin; clicks arrive through the document handle's
  // event bus.
  useEntityMarkers2D(documentHandle, {
    projectId,
    fileId,
    page: pdfCurrentPage,
    enabled: isPdf,
    onFindingClick: (f) => { openFindingInInspector(f); },
  });

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

  const handleMarkupToolChange = useCallback((_tool: MarkupTool | null) => {
    // Markup tool selection no longer interacts with marker placement.
  }, []);

  const handlePdfActiveToolChange = useCallback((tool: DocumentActiveTool) => {
    setPdfActiveTool(tool);
  }, []);

  const handleDocContextMenuInspector = useCallback((view: 'findings') => {
    setActivePanel('inspector');
    setInspectorRequest((prev) => ({ view, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // The floor-plan pane's "Add finding" routes here so the inspector uses the
  // IFC-anchored, file-scoped floor-plan findings scope (not project scope).
  const handleFloorPlanInspector = useCallback((view: 'findings') => {
    setActivePanel('inspector');
    setInspectorRequest((prev) => ({ view, nonce: (prev?.nonce ?? 0) + 1, surface: 'floorplan' }));
  }, []);

  // Lift a normalized plan point (from a 2D guided pick) to a 3D world anchor:
  // plan-point via the floor-plan engine, then world via the minimap calibration
  // at the active storey elevation. Mirrors FloorPlanPane.handleAddFinding.
  const convertFloorPlanPoint = useCallback(
    async (norm: { x: number; y: number }): Promise<{ x: number; y: number; z: number } | null> => {
      const vh = viewerHandleRef.current;
      if (!fpHandle || !vh) return null;
      const plan = await fpHandle.commands
        .execute<{ planX: number; planY: number } | null>('floorplan.planPointAtNorm', {
          nx: norm.x,
          ny: norm.y,
        })
        .catch(() => null);
      if (!plan) return null;
      const world = await vh.commands
        .execute<{ x: number; y: number; z: number } | null>('minimap.planToWorld', {
          planX: plan.planX,
          planY: plan.planY,
          elevation: fpElevation ?? 0,
        })
        .catch(() => null);
      return world ?? null;
    },
    [fpHandle, fpElevation],
  );

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
    },
  });

  let canvas: JSX.Element | null = null;
  if (error !== null) {
    canvas = (
      <ErrorBanner message={error} tone="soft" className="m-6 text-body2" />
    );
  } else if (scope.isEmpty) {
    canvas = (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-body2 font-semibold text-foreground">{tFed('empty')}</p>
        <p className="max-w-sm text-body3 text-foreground-secondary">{tFed('emptyHint')}</p>
      </div>
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
      />
    );
  } else {
    canvas = (
      <IfcViewerCanvas
        scope={scope}
        viewerEpoch={viewerEpoch}
        viewerHandleRef={viewerHandleRef}
        settings={settings}
        locale={locale}
        onSceneReady={() => {
          setSceneReady(true);
        }}
        onProgress={onProgress}
        onBusyChange={setViewerBusy}
        onReady={() => {
          setViewerReady(true);
          setProgress(null);
        }}
        onViewerError={(message) => {
          setViewerError(message);
        }}
        onModelLoadError={(modelId) => {
          setFailedModelIds((prev) => (prev.includes(modelId) ? prev : [...prev, modelId]));
        }}
        viewMode={viewMode}
        isMobile={isMobile}
        splitRatio={splitRatio}
        splitContainerRef={splitContainerRef}
        threeDPaneRef={threeDPaneRef}
        planPaneRef={planPaneRef}
        dividerRef={dividerRef}
        onDividerPointerDown={handleDividerPointerDown}
        onDividerPointerMove={handleDividerPointerMove}
        onDividerPointerUp={handleDividerPointerUp}
        hasFloorPlans={hasFloorPlans}
        viewerReady={viewerReady}
        planMetadata={planMetadata}
        projectId={projectId}
        fileId={fileId}
        onFindingClick={openFindingInInspector}
        onRequestFloorPlanInspector={handleFloorPlanInspector}
        onFpHandle={setFpHandle}
        onFpActiveElevationChange={setFpElevation}
      />
    );
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      {!mobileBannerDismissed && (
        <ViewerMobileBanner
          onDismiss={() => {
            sessionStorage.setItem('bimstitch.viewerMobileBanner', 'dismissed');
            setMobileBannerDismissed(true);
          }}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {canvas}

        {(loadingActive || overlayFading) ? (
          <ViewerLoadingOverlay
            progress={progress}
            overlayFading={overlayFading}
            isIfc={isIfc}
            viewerReady={viewerReady}
            viewerBusy={viewerBusy}
            tLoad={tLoad}
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
                  openFindingId={openFinding?.id}
                  openFindingNonce={openFinding?.nonce}
                  floorPlan={inspectorRequest?.surface === 'floorplan' && viewMode !== '3d'}
                  documentHandle={documentHandle}
                  viewerHandle={viewerHandleRef.current}
                  viewMode={viewMode}
                  floorPlanHandle={fpHandle}
                  convertFloorPlanPoint={convertFloorPlanPoint}
                  onNavigateToPage={isPdf ? setPdfCurrentPage : undefined}
                  {...(isPdf ? {
                    isPdf: true,
                    pdfCurrentPage,
                  } : {})}
                />
              }
              explorerContent={isIfc ? (
                <ModelExplorer
                  models={explorerModels}
                  metadata={metadata}
                  isLoading={explorerModelsLoading || (isLoadingMetadata ?? false)}
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
                <BcfPanel
                  projectId={projectId}
                  controller={bcf3dController}
                  modelId={modelId}
                  fileId={fileId}
                  dimension="3d"
                />
              ) : isPdf ? (
                <BcfPanel
                  projectId={projectId}
                  controller={bcf2dController}
                  modelId={modelId}
                  fileId={fileId}
                  dimension="2d"
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
              onSettingsChange={handleSettingsChange}
              onReloadViewer={() => {
                setViewerReady(false);
                setSceneReady(false);
                setProgress(null);
                setViewerEpoch((n) => n + 1);
              }}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              hasFloorPlans={hasFloorPlans}
              floorPlansUrl={scope.planFloorPlansUrl}
              planMetadata={planMetadata}
              viewerReady={viewerReady}
              {...(scope.planViewerModelId ? { planModelId: scope.planViewerModelId } : {})}
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

        {failedModelIds.length > 0 ? (
          <div
            role="alert"
            className="pointer-events-none absolute left-4 top-9 z-40 rounded-md bg-warning-lighter px-2 py-1 text-caption text-warning shadow-sm"
          >
            {tFed('modelLoadFailed', { count: failedModelIds.length })}
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
