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
import { useLocale, useTranslations } from 'next-intl';

import type {
  DocumentActiveTool,
  DocumentEvents,
  DocumentViewerHandle,
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
import { buildStoreyMembership } from '@/features/viewer/3d/minimap/storeyMembership';
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

// One viewer for both 2D surfaces: the generated plan renders through the
// `floorPlan` source, the calibrated sheet through `fileUrl` (PDF). See
// [[2d-viewer-threejs-unification]] — the floor-plan engine was folded into
// DocumentEngine so both share one handle + plugin stack.
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
  onFpHandle?: ((handle: DocumentViewerHandle | null) => void) | undefined;
  /** Report the active storey elevation so a plan pick lifts to the right floor. */
  onActiveElevationChange?: ((elevation: number | null) => void) | undefined;
};

/**
 * The Split / 2D floor-plan pane: the world-space 2D engine rendering the
 * BIMFPLN2 plan, with a centred toolbar-style level dropdown + storey-isolation
 * toggle. Replaces the canvas-only `MinimapView variant="full"`.
 *
 * When the active storey has a *calibrated* aligned sheet, this pane substitutes
 * a `DocumentViewer` (the PDF) for the generated plan source, pushes the
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
  const locale = useLocale();
  const compassLocale = locale === 'nl' ? 'nl' : 'en';
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
  const [activeTool, setActiveTool] = useState<DocumentActiveTool>('select');
  const [fpHandle, setFpHandle] = useState<DocumentViewerHandle | null>(null);
  const [docHandle, setDocHandle] = useState<DocumentViewerHandle | null>(null);
  const [planRendered, setPlanRendered] = useState(false);
  const [docReady, setDocReady] = useState(false);
  /** User override: prefer the generated plan even when a sheet is available. */
  const [showGenerated, setShowGenerated] = useState(false);

  const handleFpRef = useCallback((h: DocumentViewerHandle | null) => {
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
    setActiveLevel,
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

  // Drag the aligned-PDF "you are here" marker → place + aim the 3D camera. The
  // PDF counterpart to the floor plan's `floorplan:cameraPose` bridge
  // (useFloorPlanLink). With the sheet transform active, `minimap.placeCamera`
  // accepts the normalized PDF page point directly, same as `document:pick`.
  useEffect(() => {
    if (!docHandle || !handle || !pdfMode) return undefined;
    return docHandle.events.on('document:cameraPose', (ev) => {
      const elevation = levels[safeLevel]?.elevation ?? 0;
      void handle.commands
        .execute('minimap.placeCamera', {
          planX: ev.hereX,
          planY: ev.hereY,
          lookX: ev.lookX,
          lookY: ev.lookY,
          elevation, // fallback only
          lockHeight: true, // pan horizontally; keep current 3D camera height
        })
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

  // Reverse storey membership (element express id → storey express id) so a 3D
  // selection can auto-follow the PDF sheet to its floor.
  const localToStorey = useMemo(() => {
    const m = new Map<number, number>();
    for (const [storeyId, ids] of buildStoreyMembership(metadata)) {
      for (const id of ids) m.set(id, storeyId);
    }
    return m;
  }, [metadata]);

  // C2 — level change moves the 3D camera to that floor's height in Split (keep
  // horizontal position + heading). Other modes leave the 3D camera alone.
  const handleSelectLevel = useCallback(
    (i: number) => {
      setActiveLevel(i);
      if (viewMode !== 'split' || !handle) return;
      const lvl = levels[i];
      if (!lvl) return;
      void (async () => {
        const pose = await handle.commands
          .execute<{ position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null>(
            'camera.getPose',
          )
          .catch(() => null);
        if (!pose) return;
        const proj = await handle.commands
          .execute<({ x: number; y: number; elevation: number } | null)[]>('minimap.projectPoints', [
            pose.position,
            pose.target,
          ])
          .catch(() => [] as ({ x: number; y: number; elevation: number } | null)[]);
        const here = proj[0];
        const look = proj[1];
        if (!here || !look) return;
        await handle.commands
          .execute('minimap.placeCamera', {
            planX: here.x,
            planY: here.y,
            lookX: look.x,
            lookY: look.y,
            elevation: lvl.elevation,
            lockHeight: false, // move the eye to the new floor's height
            animate: true,
          })
          .catch(() => undefined);
      })();
    },
    [viewMode, handle, levels],
  );

  // C3 (PDF) — 3D selection → persistent highlight on the aligned sheet + auto-
  // follow to its storey. The generated-plan counterpart lives in useFloorPlanLink
  // (fpHandle is null in pdfMode, so the two never both fire).
  useEffect(() => {
    if (!docHandle || !handle || !pdfMode || !viewerReady) return undefined;
    const clear = (): void => {
      void docHandle.commands.execute('document.setSelectionMarker', null).catch(() => undefined);
    };
    const off = handle.events.on('selection:change', (ev) => {
      void (async () => {
        const selected = ev.selected;
        if (!selected || selected.length === 0) {
          clear();
          return;
        }
        const sole = selected.length === 1 ? selected[0] : null;
        const centroid = await handle.commands
          .execute<{ x: number; y: number; z: number } | null>('camera.getSelectionCentroid')
          .catch(() => null);
        if (!centroid) return;
        const proj = await handle.commands
          .execute<{ x: number; y: number; elevation: number } | null>('minimap.projectPoint', centroid)
          .catch(() => null);
        if (!proj) return;
        // PDF mode: the minimap projects through the sheet transform → normalized
        // page coords (0..1), the frame document.setSelectionMarker expects.
        void docHandle.commands
          .execute('document.setSelectionMarker', { nx: proj.x, ny: proj.y })
          .catch(() => undefined);
        if (sole) {
          const storeyId = localToStorey.get(sole.localId);
          if (storeyId != null) {
            const idx = levels.findIndex((l) => l.storeyExpressID === storeyId);
            if (idx >= 0 && idx !== safeLevel) setActiveLevel(idx);
          }
        }
      })();
    });
    return () => {
      off();
      clear();
    };
  }, [docHandle, handle, pdfMode, viewerReady, localToStorey, levels, safeLevel]);

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
                handleSelectLevel(i);
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
              {/* Active 2D source label — which drawing the pane currently shows */}
              <span className="px-1 text-caption font-medium text-foreground-tertiary">
                {pdfMode ? t('source.alignedPdf') : t('source.generated')}
              </span>
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
            // Static true-north dial derived from the sheet alignment: the model's
            // north bearing folded with the sheet rotation so it points to the
            // model storey on the (possibly rotated) drawing. Falls back to the
            // interactive page-rotation compass when the model has no trueNorth.
            // (Sign of `rotationRad` verified against a rotated sheet at runtime.)
            {...(metadata?.trueNorth !== undefined && transform
              ? { trueNorth: metadata.trueNorth + transform.rotationRad }
              : {})}
            navCompass={{ locale: compassLocale }}
            className="absolute inset-0"
            onLoaded={() => {
              setDocReady(true);
            }}
          />
        ) : (
          <Skeleton className="absolute inset-0" />
        )
      ) : (
        <DocumentViewer
          ref={handleFpRef}
          floorPlan={data}
          roomNames={roomNames}
          colors={colors}
          {...(metadata?.trueNorth !== undefined ? { trueNorth: metadata.trueNorth } : {})}
          navCompass={{ locale: compassLocale }}
          currentPage={safeLevel + 1}
          activeTool={activeTool}
          className="absolute inset-0"
          onPageRendered={() => {
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
