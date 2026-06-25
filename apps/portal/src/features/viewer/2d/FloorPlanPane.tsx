'use client';

import dynamic from 'next/dynamic';
import {
  CaretDownIcon,
  House,
  Image,
  Move,
  StackIcon,
} from '@bimdossier/ui/icons';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useTranslations } from 'next-intl';

import type {
  DocumentEvents,
  DocumentViewerHandle,
  FloorPlanActiveTool,
  FloorPlanViewerHandle,
  ViewerHandle,
} from '@bimdossier/viewer';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@bimdossier/ui';

import {
  ToolbarGroup,
  ToolbarDivider,
  ToolButton,
} from '@/components/shared/viewer/shared/_toolbarPrimitives';
import type { ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { useAlignedSheets } from '@/features/aligned-sheets/hooks';
import { resolveColor } from '@/features/viewer/3d/minimap/spatialNames';
import { useStoreys } from '@/features/storeys/useStoreys';
import { useViewerBundle } from '@/features/viewer/shared/useViewerBundle';
import type { AlignedSheet, Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { stashPendingElementPoint } from '@/features/viewer/shared/inspector/pendingElementPoint';

import { DocumentContextMenu } from './DocumentContextMenu';
import { toSheetTransform } from './sheetTransform';
import { useAlignedSheetMarkers } from './useAlignedSheetMarkers';
import { useFloorPlanData } from './useFloorPlanData';
import { useFloorPlanFindingMarkers } from './useFloorPlanFindingMarkers';
import { useFloorPlanLink } from './useFloorPlanLink';
import { useSplitEntryCamera } from './useSplitEntryCamera';

const FloorPlanViewer = dynamic(
  () => import('@bimdossier/viewer').then((m) => m.FloorPlanViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const DocumentViewer = dynamic(
  () => import('@bimdossier/viewer').then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  floorPlansUrl: string | null;
  metadata: ModelMetadata | undefined;
  projectId: string;
  fileId: string;
  /** The 3D model's API UUID — owns storeys + aligned sheets (for substitution). */
  planModelId: string | null;
  /** Current viewer layout — drives the Split-entry camera/first-person behavior. */
  viewMode: ViewMode;
  onFindingClick: (finding: Finding) => void;
  /** Open the Findings side-panel view (e.g. from the right-click "Add finding"). */
  onRequestFindings: (view: 'findings') => void;
  /** Surface the active 2D handle (floor-plan OR aligned-sheet PDF) so the Findings panel can pin on it (2D). */
  onFpHandle?: ((handle: FloorPlanViewerHandle | DocumentViewerHandle | null) => void) | undefined;
  /** Report the active storey elevation so a plan pick lifts to the right floor. */
  onActiveElevationChange?: ((elevation: number | null) => void) | undefined;
};

/**
 * The Split / 2D floor-plan pane: the world-space 2D engine rendering the
 * BIMFPLN2 plan, with a centred toolbar-style level dropdown + storey-isolation
 * toggle. Replaces the canvas-only `MinimapView variant="full"`.
 *
 * When the active storey has a *calibrated* aligned sheet, this pane substitutes
 * a `DocumentViewer` (the PDF) for the generated `FloorPlanViewer`, pushes the
 * sheet transform onto the minimap (via `useFloorPlanLink` → `minimap.calibrate`),
 * and projects the model's findings onto the PDF. A toolbar toggle flips back to
 * the generated plan; BIMFPLN2 remains the fallback when no sheet exists.
 */
export function FloorPlanPane({
  handle,
  viewerReady,
  floorPlansUrl,
  metadata,
  projectId,
  fileId,
  planModelId,
  viewMode,
  onFindingClick,
  onRequestFindings,
  onFpHandle,
  onActiveElevationChange,
}: Props): ReactElement | null {
  const t = useTranslations('viewer.floorplan');
  const tb = useTranslations('viewer.toolbar');
  const levelFallback = useCallback((n: number) => t('levelFallback', { n }), [t]);
  const {
    data,
    levels,
    roomNames,
    planAxisX,
    planAxisY,
  } = useFloorPlanData(floorPlansUrl, metadata, levelFallback);

  const [activeLevel, setActiveLevel] = useState(0);
  const [isolate, setIsolate] = useState(true);
  const [activeTool, setActiveTool] = useState<FloorPlanActiveTool>('select');
  const [fpHandle, setFpHandle] = useState<FloorPlanViewerHandle | null>(null);
  const [docHandle, setDocHandle] = useState<DocumentViewerHandle | null>(null);
  const [planRendered, setPlanRendered] = useState(false);
  const [docReady, setDocReady] = useState(false);
  /** User override: prefer the generated plan even when a sheet is available. */
  const [showGenerated, setShowGenerated] = useState(false);

  const handleFpRef = useCallback((h: FloorPlanViewerHandle | null) => {
    setFpHandle(h);
    if (process.env.NODE_ENV === 'development') {
      Object.defineProperty(window, '__fp', {
        configurable: true,
        value: h,
        writable: true,
      });
    }
  }, []);

  const colors = useMemo(
    () => ({
      wall: resolveColor('text-foreground'),
      room: resolveColor('text-foreground-tertiary'),
      label: resolveColor('text-foreground-secondary'),
      accent: resolveColor('text-primary'),
    }),
    [],
  );

  const safeLevel = Math.min(activeLevel, Math.max(0, levels.length - 1));

  // ---- Aligned-sheet substitution: resolve a calibrated PDF for this level ----
  const storeysQuery = useStoreys(projectId, planModelId ?? '');
  const storeys = useMemo(() => storeysQuery.data ?? [], [storeysQuery.data]);
  const sheetsQuery = useAlignedSheets(
    projectId,
    planModelId ? { modelId: planModelId } : {},
  );
  const sheets = useMemo(() => sheetsQuery.data ?? [], [sheetsQuery.data]);

  // The active floor maps express_id -> storey -> its reconciled project level,
  // and sheets pin to that level. So resolve the active level id, then the sheet.
  const levelIdByExpress = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of storeys) {
      if (s.express_id != null && s.level_id != null) m.set(s.express_id, s.level_id);
    }
    return m;
  }, [storeys]);

  const sheetByLevelId = useMemo(() => {
    const m = new Map<string, AlignedSheet>();
    for (const sh of sheets) {
      if (sh.is_calibrated && sh.calibrated_pdf_file_id && !m.has(sh.level_id)) {
        m.set(sh.level_id, sh);
      }
    }
    return m;
  }, [sheets]);

  const activeExpressId = levels[safeLevel]?.storeyExpressID;
  const activeLevelId =
    activeExpressId != null ? levelIdByExpress.get(activeExpressId) : undefined;
  const activeSheet = activeLevelId ? (sheetByLevelId.get(activeLevelId) ?? null) : null;

  // Stable transform identity (recompute only when the solved fields change).
  const transform = useMemo(
    () => toSheetTransform(activeSheet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeSheet?.id,
      activeSheet?.scale,
      activeSheet?.rotation_rad,
      activeSheet?.offset_x,
      activeSheet?.offset_y,
      activeSheet?.is_calibrated,
    ],
  );

  const sheetAvailable = transform !== null && !!activeSheet?.calibrated_pdf_file_id;
  const pdfMode = sheetAvailable && !showGenerated;
  const sheetTransformForLink = pdfMode ? transform : null;

  const bundleQuery = useViewerBundle(
    projectId,
    activeSheet?.pdf_document_id ?? '',
    activeSheet?.calibrated_pdf_file_id ?? '',
  );
  const fileUrl = bundleQuery.data?.file_url ?? null;

  // Re-arm the PDF "ready" gate when the rendered sheet/page changes.
  useEffect(() => {
    setDocReady(false);
  }, [activeSheet?.pdf_document_id, activeSheet?.calibrated_pdf_file_id, activeSheet?.page_index]);

  // Surface exactly the active 2D handle so the inspector's "pin on plan" arms on
  // the right surface (the PDF sheet in pdfMode, the generated plan otherwise).
  useEffect(() => {
    onFpHandle?.(pdfMode ? docHandle : fpHandle);
  }, [pdfMode, docHandle, fpHandle, onFpHandle]);

  useFloorPlanLink({
    fpHandle,
    viewerHandle: handle,
    viewerReady,
    levels,
    activeLevel: safeLevel,
    isolate,
    metadata,
    planAxisX,
    planAxisY,
    sheetTransform: sheetTransformForLink,
  });

  useSplitEntryCamera({
    viewerHandle: handle,
    viewerReady,
    enabled: viewMode === 'split',
    levels,
    setActiveLevel,
  });

  // Generated-plan markers (disabled in PDF mode — the sheet hook owns it then).
  useFloorPlanFindingMarkers({
    fpHandle,
    viewerHandle: handle,
    viewerReady,
    projectId,
    fileId,
    data,
    activeLevel: safeLevel,
    enabled: !pdfMode,
    onFindingClick,
  });

  // Aligned-sheet markers: model findings projected through the sheet transform.
  useAlignedSheetMarkers({
    docHandle,
    viewerHandle: handle,
    viewerReady,
    projectId,
    fileId,
    levels,
    activeLevel: safeLevel,
    sheetTransform: transform,
    enabled: pdfMode,
    onFindingClick,
  });

  // Click-to-fly: a left-click on the aligned PDF (`document:pick`, enabled via
  // `linkPicks`) flies the 3D camera there. With the sheet transform active,
  // `minimap.navigateTo` accepts the normalized PDF page point directly.
  useEffect(() => {
    if (!docHandle || !handle || !pdfMode) return undefined;
    return docHandle.events.on('document:pick', (ev) => {
      const elevation = levels[safeLevel]?.elevation ?? 0;
      void handle.commands
        .execute('minimap.navigateTo', { planX: ev.x, planY: ev.y, elevation })
        .catch(() => undefined);
    });
  }, [docHandle, handle, pdfMode, levels, safeLevel]);

  // You-are-here: mirror the 3D camera pose onto the aligned PDF. The minimap
  // emits poses already projected through the sheet transform (PDF page coords);
  // seed once on calibrate since a static camera won't emit `minimap:pose`.
  useEffect(() => {
    if (!docHandle || !handle || !pdfMode || !viewerReady) return undefined;
    const push = (here: { x: number; y: number }, look: { x: number; y: number }): void => {
      void docHandle.commands
        .execute('document.setCameraPose', {
          hereX: here.x,
          hereY: here.y,
          lookX: look.x,
          lookY: look.y,
        })
        .catch(() => undefined);
    };
    const seed = async (): Promise<void> => {
      const pose = await handle.commands
        .execute<{
          position: { x: number; y: number; z: number };
          target: { x: number; y: number; z: number };
        } | null>('camera.getPose')
        .catch(() => null);
      if (!pose) return;
      const proj = await handle.commands
        .execute<({ x: number; y: number; elevation: number } | null)[]>(
          'minimap.projectPoints',
          [pose.position, pose.target],
        )
        .catch(() => [] as ({ x: number; y: number; elevation: number } | null)[]);
      const here = proj[0];
      const look = proj[1];
      if (here && look) push(here, look);
    };
    const offPose = handle.events.on('minimap:pose', (p) => {
      push(p.here, p.look);
    });
    const offCal = handle.events.on('minimap:calibrated', () => {
      void seed();
    });
    void seed();
    return () => {
      offPose();
      offCal();
    };
  }, [docHandle, handle, pdfMode, viewerReady]);

  // Right-click "Add finding" on the generated plan: convert the click to a 3D
  // world anchor at the active storey's floor elevation, then stash it so the
  // inspector creates an IFC-anchored finding linked to this model/file. If the
  // minimap isn't calibrated yet, skip the stash — the finding is still created,
  // just unanchored — rather than throwing.
  const handleAddFinding = useCallback(
    async (menu: DocumentEvents['contextmenu:open']): Promise<void> => {
      if (!fpHandle || !handle) return;
      const elevation = levels[safeLevel]?.elevation ?? 0;
      const planPoint = await fpHandle.commands
        .execute<{ planX: number; planY: number } | null>('floorplan.planPointAt', {
          containerX: menu.position.x,
          containerY: menu.position.y,
        })
        .catch(() => null);
      if (!planPoint) return;
      const world = await handle.commands
        .execute<{ x: number; y: number; z: number } | null>('minimap.planToWorld', {
          planX: planPoint.planX,
          planY: planPoint.planY,
          elevation,
        })
        .catch(() => null);
      if (world) stashPendingElementPoint(world);
    },
    [fpHandle, handle, levels, safeLevel],
  );

  // Right-click "Add finding" on the aligned PDF: the context menu gives a
  // normalized page point; with the sheet transform active `minimap.planToWorld`
  // accepts PDF coords, so we lift it to the same 3D world anchor used for the
  // projected pins (keeps PDF + 3D + generated-plan findings consistent).
  const handlePdfAddFinding = useCallback(
    async (menu: DocumentEvents['contextmenu:open']): Promise<void> => {
      if (!handle || !menu.pagePoint) return;
      const elevation = levels[safeLevel]?.elevation ?? 0;
      const world = await handle.commands
        .execute<{ x: number; y: number; z: number } | null>('minimap.planToWorld', {
          planX: menu.pagePoint.x,
          planY: menu.pagePoint.y,
          elevation,
        })
        .catch(() => null);
      if (world) stashPendingElementPoint(world);
    },
    [handle, levels, safeLevel],
  );

  // Report the active storey elevation so the inspector's plan-pick can lift the
  // picked point to the correct floor (same elevation `handleAddFinding` uses).
  useEffect(() => {
    onActiveElevationChange?.(levels[safeLevel]?.elevation ?? null);
  }, [levels, safeLevel, onActiveElevationChange]);

  if (!data || levels.length === 0) return null;
  const level = levels[safeLevel];
  const levelName = level !== undefined ? level.name : '';
  const ctxHandle = pdfMode ? docHandle : fpHandle;

  const levelPicker = levels.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 max-w-[160px] items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground/80 hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <span className="truncate">{levelName}</span>
            <CaretDownIcon className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" sideOffset={6} className="max-h-60 overflow-y-auto">
          {levels.map((lv, i) => (
            <DropdownMenuItem
              key={lv.storeyExpressID}
              onSelect={() => {
                setActiveLevel(i);
              }}
            >
              {lv.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
  ) : (
      <span className="max-w-[160px] truncate px-2 text-caption text-foreground-secondary">
        {levelName}
      </span>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-low">
      {/* Centred toolbar-style pill at the top of the pane */}
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <ToolbarGroup className="gap-0.5">
          {levelPicker}
          <ToolbarDivider />
          <ToolButton
            isActive={isolate}
            onClick={() => {
              setIsolate((v) => !v);
            }}
            aria-pressed={isolate}
            aria-label={isolate ? t('allLevels') : t('isolateLevel')}
            title={isolate ? t('allLevels') : t('isolateLevel')}
            className="h-8 w-8"
          >
            <StackIcon className="h-4 w-4" />
          </ToolButton>
          {sheetAvailable && (
            <>
              <ToolbarDivider />
              {/* Toggle between the calibrated PDF sheet and the generated plan */}
              <ToolButton
                isActive={pdfMode}
                onClick={() => {
                  setShowGenerated((v) => !v);
                }}
                aria-pressed={pdfMode}
                aria-label={pdfMode ? t('showGeneratedPlan') : t('showAlignedSheet')}
                title={pdfMode ? t('showGeneratedPlan') : t('showAlignedSheet')}
                className="h-8 w-8"
              >
                <Image className="h-4 w-4" />
              </ToolButton>
            </>
          )}
          {viewMode === '2d' && (
            <>
              <ToolbarDivider />
              {/* Home — reset the plan/sheet to its default framing */}
              <ToolButton
                onClick={() => {
                  ctxHandle?.fitPage();
                }}
                disabled={!ctxHandle}
                aria-label={tb('homeView')}
                title={tb('homeView')}
                className="h-8 w-8"
              >
                <House className="h-4 w-4" />
              </ToolButton>
              {/* Pan — toggle left-drag panning (second click returns to select) */}
              <ToolButton
                isActive={activeTool === 'pan'}
                onClick={() => {
                  setActiveTool((cur) => (cur === 'pan' ? 'select' : 'pan'));
                }}
                aria-pressed={activeTool === 'pan'}
                aria-label={tb('pan')}
                title={tb('panTooltip')}
                className="h-8 w-8"
              >
                <Move className="h-4 w-4" />
              </ToolButton>
            </>
          )}
        </ToolbarGroup>
      </div>
      {pdfMode ? (
        fileUrl !== null ? (
          <DocumentViewer
            key={`${activeSheet?.pdf_document_id ?? ''}:${activeSheet?.calibrated_pdf_file_id ?? ''}:${activeSheet?.page_index ?? 0}`}
            ref={setDocHandle}
            fileUrl={fileUrl}
            currentPage={(activeSheet?.page_index ?? 0) + 1}
            activeTool={activeTool}
            linkPicks
            linkColor={colors.accent}
            className="absolute inset-0"
            onLoaded={() => {
              setDocReady(true);
            }}
          />
        ) : (
          <Skeleton className="absolute inset-0" />
        )
      ) : (
        <FloorPlanViewer
          ref={handleFpRef}
          data={data}
          roomNames={roomNames}
          activeLevel={safeLevel}
          activeTool={activeTool}
          colors={colors}
          className="absolute inset-0"
          onLevelRendered={() => {
            if (!planRendered) setPlanRendered(true);
          }}
        />
      )}
      <DocumentContextMenu
        handle={ctxHandle}
        onRequestFindings={onRequestFindings}
        onAddFinding={pdfMode ? handlePdfAddFinding : handleAddFinding}
        ready={pdfMode ? docReady : planRendered}
      />
    </div>
  );
}
