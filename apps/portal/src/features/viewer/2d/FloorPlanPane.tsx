'use client';

import dynamic from 'next/dynamic';
import {
  CaretDownIcon,
  House,
  Move,
  StackIcon,
} from '@bimstitch/ui/icons';
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
  FloorPlanActiveTool,
  FloorPlanViewerHandle,
  ViewerHandle,
} from '@bimstitch/viewer';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@bimstitch/ui';

import {
  ToolbarGroup,
  ToolbarDivider,
  ToolButton,
} from '@/components/shared/viewer/shared/_toolbarPrimitives';
import type { ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { resolveColor } from '@/features/viewer/3d/minimap/spatialNames';
import type { Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { stashPendingElementPoint } from '@/features/viewer/shared/inspector/pendingElementPoint';

import { DocumentContextMenu } from './DocumentContextMenu';
import { useFloorPlanData } from './useFloorPlanData';
import { useFloorPlanFindingMarkers } from './useFloorPlanFindingMarkers';
import { useFloorPlanLink } from './useFloorPlanLink';
import { useSplitEntryCamera } from './useSplitEntryCamera';

const FloorPlanViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.FloorPlanViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  floorPlansUrl: string | null;
  metadata: ModelMetadata | undefined;
  projectId: string;
  fileId: string;
  /** Current viewer layout — drives the Split-entry camera/first-person behavior. */
  viewMode: ViewMode;
  onFindingClick: (finding: Finding) => void;
  /** Open a side-panel inspector view (e.g. from the right-click "Add finding"). */
  onRequestInspector: (view: 'findings') => void;
  /** Surface the plan handle up so the inspector can pin on the plan in 2D mode. */
  onFpHandle?: ((handle: FloorPlanViewerHandle | null) => void) | undefined;
  /** Report the active storey elevation so a plan pick lifts to the right floor. */
  onActiveElevationChange?: ((elevation: number | null) => void) | undefined;
};

/**
 * The Split / 2D floor-plan pane: the world-space 2D engine rendering the
 * BIMFPLN2 plan, with a centred toolbar-style level dropdown + storey-isolation
 * toggle. Replaces the canvas-only `MinimapView variant="full"`.
 */
export function FloorPlanPane({
  handle,
  viewerReady,
  floorPlansUrl,
  metadata,
  projectId,
  fileId,
  viewMode,
  onFindingClick,
  onRequestInspector,
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
  const [planRendered, setPlanRendered] = useState(false);

  const handleFpRef = useCallback((h: FloorPlanViewerHandle | null) => {
    setFpHandle(h);
    onFpHandle?.(h);
    if (process.env.NODE_ENV === 'development') {
      Object.defineProperty(window, '__fp', {
        configurable: true,
        value: h,
        writable: true,
      });
    }
  }, [onFpHandle]);

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
  });

  useSplitEntryCamera({
    viewerHandle: handle,
    viewerReady,
    enabled: viewMode === 'split',
    levels,
    setActiveLevel,
  });

  useFloorPlanFindingMarkers({
    fpHandle,
    viewerHandle: handle,
    viewerReady,
    projectId,
    fileId,
    data,
    activeLevel: safeLevel,
    enabled: true,
    onFindingClick,
  });

  // Right-click "Add finding" on the plan: convert the click to a 3D world
  // anchor at the active storey's floor elevation, then stash it so the
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

  // Report the active storey elevation so the inspector's plan-pick can lift the
  // picked point to the correct floor (same elevation `handleAddFinding` uses).
  useEffect(() => {
    onActiveElevationChange?.(levels[safeLevel]?.elevation ?? null);
  }, [levels, safeLevel, onActiveElevationChange]);

  if (!data || levels.length === 0) return null;
  const level = levels[safeLevel];
  const levelName = level !== undefined ? level.name : '';

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
          {viewMode === '2d' && (
            <>
              <ToolbarDivider />
              {/* Home — reset the plan to its default framing */}
              <ToolButton
                onClick={() => {
                  if (fpHandle) fpHandle.fitPage();
                }}
                disabled={!fpHandle}
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
      <DocumentContextMenu
        handle={fpHandle}
        onRequestInspector={onRequestInspector}
        onAddFinding={handleAddFinding}
        ready={planRendered}
      />
    </div>
  );
}
