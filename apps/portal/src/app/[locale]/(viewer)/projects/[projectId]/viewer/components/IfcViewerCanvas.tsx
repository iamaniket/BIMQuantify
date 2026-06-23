'use client';

import dynamic from 'next/dynamic';
import type React from 'react';
import { type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';
import type { FloorPlanViewerHandle, ViewerHandle } from '@bimstitch/viewer';

import { FloorPlanPane } from '@/features/viewer/2d/FloorPlanPane';
import { type ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import type { Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import type { ViewerSettings } from '@/lib/viewerSettings';
import type { ViewerScope } from '@/features/viewer/shared/useViewerScope';

const IfcViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.IfcViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export interface IfcViewerCanvasProps {
  scope: ViewerScope;
  viewerEpoch: number;
  viewerHandleRef: React.MutableRefObject<ViewerHandle | null>;
  settings: ViewerSettings;
  locale: string;
  onSceneReady: () => void;
  onProgress: (loaded: number, total: number) => void;
  onBusyChange: (busy: boolean) => void;
  onReady: (handle: ViewerHandle) => void;
  onViewerError: (message: string) => void;
  onModelLoadError: (modelId: string) => void;
  viewMode: ViewMode;
  isMobile: boolean;
  splitRatio: number;
  splitContainerRef: React.RefObject<HTMLDivElement | null>;
  threeDPaneRef: React.RefObject<HTMLDivElement | null>;
  planPaneRef: React.RefObject<HTMLDivElement | null>;
  dividerRef: React.RefObject<HTMLDivElement | null>;
  onDividerPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDividerPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDividerPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  hasFloorPlans: boolean;
  viewerReady: boolean;
  planMetadata: ModelMetadata | undefined;
  projectId: string;
  fileId: string;
  onFindingClick: (finding: Finding) => void;
  onRequestFloorPlanFindings: (view: 'findings') => void;
  /** Surface the floor-plan handle up so the Findings panel can pin on the plan (2D). */
  onFpHandle?: ((handle: FloorPlanViewerHandle | null) => void) | undefined;
  /** Report the active storey elevation for the plan-pick → world conversion. */
  onFpActiveElevationChange?: ((elevation: number | null) => void) | undefined;
}

export function IfcViewerCanvas({
  scope,
  viewerEpoch,
  viewerHandleRef,
  settings,
  locale,
  onSceneReady,
  onProgress,
  onBusyChange,
  onReady,
  onViewerError,
  onModelLoadError,
  viewMode,
  isMobile,
  splitRatio,
  splitContainerRef,
  threeDPaneRef,
  planPaneRef,
  dividerRef,
  onDividerPointerDown,
  onDividerPointerMove,
  onDividerPointerUp,
  hasFloorPlans,
  viewerReady,
  planMetadata,
  projectId,
  fileId,
  onFindingClick,
  onRequestFloorPlanFindings,
  onFpHandle,
  onFpActiveElevationChange,
}: IfcViewerCanvasProps): JSX.Element {
  const ifcViewerEl = (
    <IfcViewer
      key={`${scope.sceneKey}:${viewerEpoch}`}
      ref={viewerHandleRef}
      bundle={scope.primaryBundle!}
      additionalBundles={scope.additionalBundles}
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
      hoverHighlight={{
        color: settings.behavior.hoverHighlight.color,
        enabled: settings.behavior.hoverHighlight.enabled,
      }}
      selectionHighlight={{ color: settings.behavior.selection.color }}
      shortcuts={settings.shortcuts}
      mouseBindings={settings.mouseBindings}
      controls={settings.controls}
      zoom={settings.zoom}
      interactivePerformance={settings.interactivePerformance}
      cameraFly={{
        moveFraction: settings.cameraFly.moveFraction,
        turnSpeed: (settings.cameraFly.turnSpeedDeg * Math.PI) / 180,
        lookSensitivity: settings.cameraFly.lookSensitivity,
      }}
      onSceneReady={() => {
        onSceneReady();
      }}
      onProgress={onProgress}
      onBusyChange={onBusyChange}
      onReady={(handle) => {
        viewerHandleRef.current = handle;
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__viewer = handle;
        }
        onReady(handle);
      }}
      onError={(err) => {
        onViewerError(err.message);
      }}
      onModelLoadError={(modelId) => {
        onModelLoadError(modelId);
      }}
    />
  );
  // Split / 2D layout. Panes are ABSOLUTELY positioned so the WebGL/plan
  // canvases never drive the flex layout width (fixed-size canvases otherwise
  // propagate their intrinsic width up the tree and break the split). The 3D
  // viewer is ALWAYS mounted (hidden only in 2D) so the minimap plugin keeps
  // driving the model and isolation persists across mode switches.
  // Mobile (<md): stacks top/bottom with fixed h-1/2 — no dragging.
  // Desktop (md+): side-by-side; splitRatio drives inline width styles and
  // the draggable divider updates them imperatively during drag.
  const threeDPaneClass =
    viewMode === '2d'
      ? 'hidden'
      : viewMode === 'split'
        ? 'absolute inset-x-0 top-0 h-1/2 overflow-hidden md:inset-y-0 md:right-auto md:h-full'
        : 'absolute inset-0 overflow-hidden';
  const planPaneClass =
    viewMode === '2d'
      ? 'absolute inset-0 overflow-hidden'
      : viewMode === 'split'
        ? 'absolute inset-x-0 bottom-0 h-1/2 overflow-hidden border-t border-border md:inset-y-0 md:right-0 md:left-auto md:h-full md:border-t-0'
        : 'absolute inset-0 overflow-hidden';

  // Desktop inline styles drive the dynamic split ratio; mobile uses h-1/2 class.
  const threeDSplitStyle =
    viewMode === 'split' && !isMobile ? { width: `${splitRatio * 100}%` } : undefined;
  const planSplitStyle =
    viewMode === 'split' && !isMobile ? { width: `${(1 - splitRatio) * 100}%` } : undefined;

  return (
    <div
      ref={splitContainerRef}
      className="relative h-full w-full overflow-hidden"
    >
      <div ref={threeDPaneRef} className={threeDPaneClass} style={threeDSplitStyle}>
        {ifcViewerEl}
      </div>

      {/* Draggable divider — desktop split mode only */}
      {viewMode === 'split' && !isMobile && (
        <div
          ref={dividerRef}
          className="absolute inset-y-0 z-20 flex w-2 cursor-col-resize touch-none select-none flex-col items-center justify-center"
          style={{ left: `calc(${splitRatio * 100}% - 4px)` }}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
        >
          {/* Thin visual bar */}
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          {/* Drag pip */}
          <div className="relative z-10 flex h-8 w-3 items-center justify-center rounded-full border border-border bg-surface-low shadow-sm">
            <div className="h-3 w-px rounded-full bg-foreground-tertiary" />
          </div>
        </div>
      )}

      {hasFloorPlans && viewMode !== '3d' && scope.planFloorPlansUrl ? (
        <div ref={planPaneRef} className={planPaneClass} style={planSplitStyle}>
          <FloorPlanPane
            handle={viewerHandleRef.current}
            viewerReady={viewerReady}
            floorPlansUrl={scope.planFloorPlansUrl}
            metadata={planMetadata}
            projectId={projectId}
            fileId={scope.planFileId ?? fileId}
            viewMode={viewMode}
            onFindingClick={onFindingClick}
            onRequestFindings={onRequestFloorPlanFindings}
            onFpHandle={onFpHandle}
            onActiveElevationChange={onFpActiveElevationChange}
          />
        </div>
      ) : null}
    </div>
  );
}
