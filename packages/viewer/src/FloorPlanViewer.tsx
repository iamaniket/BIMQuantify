'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
  type JSX,
} from 'react';

import { FloorPlanEngine } from './floorplan-core/FloorPlanEngine.js';
import type { EventBus } from './core/EventBus.js';
import type {
  DocumentEvents,
  DocumentPlugin,
  DocumentTool,
} from './pdf-core/documentTypes.js';
import type { DecodedFloorPlans } from './plugins/3d/shared/floorplan-codec.js';
import type { CameraControlsConfig } from './plugins/2d/camera/index.js';
import { cameraPlugin } from './plugins/2d/camera/index.js';
import { contextMenuPlugin } from './plugins/2d/context-menu/index.js';
import { entityMarker2DPlugin } from './plugins/2d/entity-marker/index.js';
import { interaction2DPlugin } from './plugins/2d/interaction/index.js';
import {
  floorPlanPlugin,
  type FloorPlanColors,
  type FloorPlanPluginAPI,
} from './plugins/2d/floorplan/index.js';
import { measurePlugin } from './plugins/2d/measure/index.js';
import { mouseBindings2DPlugin } from './plugins/2d/mouse-bindings/index.js';
import { scenePlugin } from './plugins/2d/scene/index.js';
import { toolsPlugin } from './plugins/2d/tools/index.js';

export type FloorPlanActiveTool = DocumentTool;

/**
 * Imperative handle — the floor-plan counterpart to `DocumentViewerHandle`.
 * Same generic command/event/plugin surface plus a few plan-specific façades.
 */
export type FloorPlanViewerHandle = {
  fitPage(): void;
  setLevel(index: number): void;
  focusPlanPoint(planX: number, planY: number): void;
  pulseAt(planX: number, planY: number): void;
  /** Position the "you are here" camera marker (plan coords). Null hides it. */
  setCameraPose(pose: { hereX: number; hereY: number; lookX: number; lookY: number } | null): void;
  commands: {
    execute<R = unknown>(name: string, args?: unknown): Promise<R>;
    has(name: string): boolean;
    list(): { name: string; meta: unknown }[];
  };
  events: Pick<EventBus<DocumentEvents>, 'on' | 'off' | 'once'>;
  plugins: {
    register(plugin: DocumentPlugin): Promise<void>;
    unregister(name: string): Promise<void>;
    get<T = unknown>(name: string): T | null;
  };
};

export type FloorPlanViewerProps = {
  /** Decoded floor-plan artifact (fetched + decoded by the portal). */
  data: DecodedFloorPlans;
  /** spaceId → room label, joined from model metadata. */
  roomNames?: Map<number, string>;
  /** Active storey index into `data.levels` (0-based, controlled). */
  activeLevel: number;
  activeTool?: FloorPlanActiveTool;
  controls?: CameraControlsConfig;
  /** Theme-resolved plan colors (wall/room/label/accent). */
  colors?: Partial<FloorPlanColors>;
  className?: string;
  onLevelRendered?: (index: number) => void;
};

function FloorPlanViewerInner(
  { data, roomNames, activeLevel, activeTool = 'select', controls, colors, className, onLevelRendered }: FloorPlanViewerProps,
  ref: ForwardedRef<FloorPlanViewerHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const webglHostRef = useRef<HTMLDivElement>(null);
  const viewportOverlayRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FloorPlanEngine | null>(null);

  // Live refs so the mount-time seed reads current controlled-prop values.
  const activeLevelRef = useRef(activeLevel);
  const activeToolRef = useRef<FloorPlanActiveTool>(activeTool);
  const controlsRef = useRef(controls);
  const colorsRef = useRef(colors);
  const roomNamesRef = useRef(roomNames);
  const onLevelRenderedRef = useRef(onLevelRendered);
  useEffect(() => {
    activeLevelRef.current = activeLevel;
    activeToolRef.current = activeTool;
    controlsRef.current = controls;
    colorsRef.current = colors;
    roomNamesRef.current = roomNames;
    onLevelRenderedRef.current = onLevelRendered;
  });

  // ---- Engine lifecycle. Remount only when the decoded data changes. ----
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    const overlay = overlayRef.current;
    const webglHost = webglHostRef.current;
    const viewportOverlay = viewportOverlayRef.current;
    if (!container || !canvas || !textLayer || !overlay || !webglHost || !viewportOverlay) return undefined;

    const plugins: DocumentPlugin[] = [
      toolsPlugin(),
      scenePlugin(),
      cameraPlugin(controlsRef.current ? { controls: controlsRef.current } : {}),
      // Route a plain left-click to the floor-plan pick command (2D→3D linking).
      mouseBindings2DPlugin({ overrides: { 'click:left': 'floorplan.pick' } }),
      measurePlugin(),
      entityMarker2DPlugin(),
      // Guided-pick overlay on top of entity-marker placement (interaction.request).
      interaction2DPlugin(),
      contextMenuPlugin(),
      floorPlanPlugin({
        data,
        ...(roomNamesRef.current ? { roomNames: roomNamesRef.current } : {}),
        ...(colorsRef.current ? { colors: colorsRef.current } : {}),
      }),
    ];

    const engine = new FloorPlanEngine({ plugins });
    engineRef.current = engine;
    let cancelled = false;

    (async () => {
      await engine.mount({ container, canvas, textLayer, overlayHost: overlay, webglHost, viewportOverlay });
      if (cancelled) return;

      engine.events.on('page:rendered', ({ pageNumber }) => {
        onLevelRenderedRef.current?.(pageNumber - 1);
      });

      // Seed controlled-prop values before load, then load the decoded data
      // (which emits doc:loaded + the synthetic page:rendered).
      engine.setCurrentPage(activeLevelRef.current + 1);
      engine.setTool(activeToolRef.current);
      engine.load(data);
    })();

    return () => {
      cancelled = true;
      engine.unmount().catch(() => undefined);
      engineRef.current = null;
    };
  }, [data]);

  // ---- Drive controlled props into the engine ----
  useEffect(() => { engineRef.current?.setCurrentPage(activeLevel + 1); }, [activeLevel]);
  useEffect(() => { engineRef.current?.setTool(activeTool); }, [activeTool]);
  useEffect(() => {
    if (!controls || !engineRef.current) return;
    if (engineRef.current.commands.has('camera.setControls')) {
      void engineRef.current.commands.execute('camera.setControls', controls);
    }
  }, [controls]);

  // ---- Imperative handle ----
  useImperativeHandle(
    ref,
    (): FloorPlanViewerHandle => ({
      fitPage: () => { void engineRef.current?.commands.execute('camera.fitPage'); },
      setLevel: (index) => { engineRef.current?.setCurrentPage(index + 1); },
      focusPlanPoint: (planX, planY) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.focusPlanPoint(planX, planY);
      },
      pulseAt: (planX, planY) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.pulseAt(planX, planY);
      },
      setCameraPose: (pose) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.setCameraPose(pose);
      },
      commands: {
        execute: <R,>(name: string, args?: unknown): Promise<R> => {
          const e = engineRef.current;
          if (!e) return Promise.reject(new Error('FloorPlanViewer not mounted'));
          return e.commands.execute<unknown, R>(name, args);
        },
        has: (name: string) => engineRef.current?.commands.has(name) ?? false,
        list: () => engineRef.current?.commands.list() ?? [],
      },
      events: {
        on: (key, h) => engineRef.current?.events.on(key, h) ?? (() => undefined),
        off: (key, h) => engineRef.current?.events.off(key, h),
        once: (key, h) => engineRef.current?.events.once(key, h) ?? (() => undefined),
      },
      plugins: {
        register: async (p) => { await engineRef.current?.registerPlugin(p); },
        unregister: async (name) => { await engineRef.current?.unregisterPlugin(name); },
        get: <T,>(name: string): T | null => engineRef.current?.getPlugin<T>(name) ?? null,
      },
    }),
    [],
  );

  return (
    <div className={className} data-testid="floorplan-viewer-shell" style={{ overflow: 'hidden' }}>
      <div
        ref={containerRef}
        data-testid="floorplan-viewer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {/* canvas + textLayer are required by the DocumentContext contract but
            unused for floor plans (no raster, no text layer). */}
        <canvas ref={canvasRef} style={{ position: 'absolute', display: 'none' }} />
        <div ref={textLayerRef} style={{ position: 'absolute', display: 'none' }} />
        <div ref={webglHostRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }} />
        <div ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
      </div>
      <div
        ref={viewportOverlayRef}
        data-testid="floorplan-viewport-overlay"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

export const FloorPlanViewer = forwardRef<FloorPlanViewerHandle, FloorPlanViewerProps>(
  FloorPlanViewerInner,
);
FloorPlanViewer.displayName = 'FloorPlanViewer';
