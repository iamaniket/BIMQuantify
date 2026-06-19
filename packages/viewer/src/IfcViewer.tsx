'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type JSX,
} from 'react';

import { Viewer } from './core/Viewer.js';
import { vlog, vwarn, verror } from './core/debugLog.js';
import { getCached, putCached } from './fragmentCache.js';
import { fetchFragments } from './loadFragments.js';
import { cameraPlugin } from './plugins/3d/camera/index.js';
import { cameraFlyPlugin } from './plugins/3d/camera-fly/index.js';
import { effectsPlugin } from './plugins/3d/effects/index.js';
import { hoverHighlightPlugin } from './plugins/3d/hover-highlight/index.js';
import { interactivePerformancePlugin } from './plugins/3d/interactive-performance/index.js';
import { performanceCullingPlugin } from './plugins/3d/performance-culling/index.js';
import { keyboardShortcutsPlugin } from './plugins/3d/keyboard-shortcuts/index.js';
import { mouseBindingsPlugin } from './plugins/3d/mouse-bindings/index.js';
import { navigatePlugin } from './plugins/3d/navigate/index.js';
import { pivotRotatePlugin } from './plugins/3d/pivot-rotate/index.js';
import { selectionPlugin } from './plugins/3d/selection/index.js';
import { viewCubePlugin } from './plugins/3d/viewcube/index.js';
import { visibilityPlugin } from './plugins/3d/visibility/index.js';
import { inspectPlugin } from './plugins/3d/inspect/index.js';
import { eraserPlugin } from './plugins/3d/eraser/index.js';
import { placementPlugin } from './plugins/3d/placement/index.js';
import { interactionPlugin } from './plugins/3d/interaction/index.js';
import { toolManagerPlugin } from './plugins/3d/tool-manager/index.js';
import { contextMenuPlugin } from './plugins/3d/context-menu/index.js';
import { xrayPlugin } from './plugins/3d/xray/index.js';
import { displayModePlugin } from './plugins/3d/display-mode/index.js';
import { outlinePlugin } from './plugins/3d/outline/index.js';
import { modePlugin } from './plugins/3d/mode/index.js';
import { sectionPlugin } from './plugins/3d/section/index.js';
import { measurementPlugin } from './plugins/3d/measurement/index.js';
import { snappingPlugin } from './plugins/3d/snapping/index.js';
import { wireframePlugin } from './plugins/3d/wireframe/index.js';
import { classifierPlugin } from './plugins/3d/classifier/index.js';
import { minimapPlugin } from './plugins/3d/minimap/index.js';
import { itemsFinderPlugin } from './plugins/3d/items-finder/index.js';
import { boundingBoxerPlugin } from './plugins/3d/bounding-boxer/index.js';
import { viewpointsPlugin } from './plugins/3d/viewpoints/index.js';
import { markerPlugin } from './plugins/3d/marker/index.js';
import { entityMarkerPlugin } from './plugins/3d/entity-marker/index.js';
import { gridPlugin } from './plugins/3d/grid/index.js';
import { screenshotPlugin } from './plugins/3d/screenshot/index.js';
import { bcfPlugin } from './plugins/3d/bcf/index.js';
import { colorCodingPlugin } from './plugins/3d/color-coding/index.js';
import { exploderPlugin } from './plugins/3d/exploder/index.js';
import type { IfcViewerProps, ViewerBundle, ViewerHandle } from './types.js';

/**
 * Plugin names kept under the `'minimal'` preset — the mobile snagging flow
 * (orbit + tap-select/hover + finding pins + tap-to-place). Chosen to be
 * dependency-CLOSED so filtering the dependency-ordered built-in array by this
 * set never drops a hard dependency:
 *   - selection ← hover-highlight (opt), visibility, placement
 *   - mouse-bindings ← placement
 *   - placement ← interaction (guided-pick overlay)
 *   - camera ← viewcube
 *   - visibility/hover-highlight ← interactive-performance (opt)
 * Everything else (measurement, snapping, section, classifier, minimap, bcf,
 * outline, x-ray, exploder, grid, …) is intentionally excluded — the embed
 * never drives those commands, and the edge-overlay/effects paths degrade
 * gracefully when their plugins are absent.
 */
const MINIMAL_BUILTIN_PLUGINS = new Set<string>([
  'camera',
  'mouse-bindings',
  'selection',
  'hover-highlight',
  'visibility',
  'placement',
  'interaction',
  'pivot-rotate',
  'viewcube',
  'interactive-performance',
  'performance-culling',
  'entity-marker',
]);

/**
 * Fetch (cache-first) + load one bundle into a viewer. The precomputed-outline
 * fetch runs in parallel and never blocks the model load. `onProgress` is only
 * passed for the primary bundle; federated extras load quietly.
 */
async function loadBundleInto(
  viewer: Viewer,
  b: ViewerBundle,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const precomputedOutline = b.outlineUrl
    ? fetchOutlineArtifact(b.outlineUrl, b.cacheKey)
    : null;
  let bytes: Uint8Array | null = null;
  if (b.cacheKey) bytes = await getCached(b.cacheKey);
  if (bytes === null) {
    bytes = await fetchFragments(b.fragmentsUrl, onProgress);
    if (b.cacheKey && bytes.byteLength > 0) {
      putCached(b.cacheKey, bytes).catch(() => undefined);
    }
  }
  await viewer.loadFragments(bytes, {
    ...(precomputedOutline ? { precomputedOutline } : {}),
    ...(b.modelId ? { modelId: b.modelId } : {}),
  });
}

/**
 * The full, ordered, de-duplicated set of models the viewer should hold:
 * `bundle` (index 0 — loaded first so the camera frames on it) followed by
 * `additionalBundles`. Each entry is keyed by its stable `modelId`
 * (`file-<fileId>`) when present, falling back to `fragmentsUrl`, so a refreshed
 * presigned URL never re-keys an already-loaded model. The diff effect operates
 * on this set, treating the primary like any other model.
 */
function buildDesired(props: IfcViewerProps): { key: string; bundle: ViewerBundle }[] {
  const seen = new Set<string>();
  const out: { key: string; bundle: ViewerBundle }[] = [];
  for (const b of [props.bundle, ...(props.additionalBundles ?? [])]) {
    const key = b.modelId ?? b.fragmentsUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, bundle: b });
  }
  return out;
}

/**
 * Headless React wrapper around `Viewer`. Renders a fullsize <div>; the
 * viewer mounts itself into it and pushes state out via the imperative
 * handle. The component intentionally has no toolbar/panels — that UI
 * lives in the host app and drives the viewer through `handle.commands`.
 */
function IfcViewerImpl(
  props: IfcViewerProps,
  forwardedRef: ForwardedRef<ViewerHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handleRef = useRef<ViewerHandle | null>(null);

  useImperativeHandle(forwardedRef, () => {
    if (handleRef.current) return handleRef.current;
    // Stable proxy: each method reads the live viewer at call time so
    // the ref is valid for the lifetime of the component, not just one
    // mount cycle.
    const handle: ViewerHandle = {
      commands: {
        execute: <R,>(name: string, args?: unknown): Promise<R> => {
          const v = viewerRef.current;
          if (!v) return Promise.reject(new Error('Viewer not mounted'));
          return v.commands.execute<unknown, R>(name, args);
        },
        has: (name: string) => viewerRef.current?.commands.has(name) ?? false,
        list: () => viewerRef.current?.commands.list() ?? [],
      },
      events: {
        on: (key, h) => viewerRef.current?.events.on(key, h) ?? (() => undefined),
        off: (key, h) => viewerRef.current?.events.off(key, h),
        once: (key, h) =>
          viewerRef.current?.events.once(key, h) ?? (() => undefined),
      },
      plugins: {
        register: async (p) => {
          await viewerRef.current?.registerPlugin(p);
        },
        unregister: async (name) => {
          await viewerRef.current?.unregisterPlugin(name);
        },
        get: <T,>(name: string) =>
          (viewerRef.current?.getPlugin(name) as T | null) ?? null,
      },
      getModelId: () => viewerRef.current?.modelId ?? null,
      getModelIds: () => viewerRef.current?.getModelIds() ?? [],
    };
    handleRef.current = handle;
    return handle;
  }, []);

  // Stable dependency for the diff effect — changes only when the MEMBERSHIP of
  // the desired model set changes (primary + extras), keyed by the stable
  // `modelId` so a refreshed presigned URL never re-keys an already-loaded model
  // and a layer's visibility toggle never re-runs the diff.
  const desiredKey = [props.bundle, ...(props.additionalBundles ?? [])]
    .map((b) => b.modelId ?? b.fragmentsUrl)
    .join('|');

  // Mount-once + unified diff: the mount effect mounts the viewer with NO model;
  // `mounted` gates the single diff effect below, which loads/unloads the FULL
  // desired set (primary + extras) as a delta in place — no remount, no camera
  // reset, and ANY model (including the primary) can be added/removed alone.
  const [mounted, setMounted] = useState(false);
  const loadedRef = useRef<Set<string>>(new Set());
  const firstDiffRef = useRef(true);
  const onReadyFiredRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    const userPlugins = props.plugins ?? [];
    const shortcuts = props.shortcuts;
    const viewCubeOpts = props.viewCube;
    const viewCubeEnabled = viewCubeOpts?.enabled ?? true;

    const builtIns = [
      cameraPlugin(),
      hoverHighlightPlugin(props.hoverHighlight ?? {}),
      selectionPlugin(props.selectionHighlight ?? {}),
      visibilityPlugin(),
      inspectPlugin(),
      outlinePlugin(props.outline ?? {}),
      xrayPlugin(),
      // Mouse-bindings registers AFTER selection/hover so the default
      // bindings can resolve `selection.pickSet` etc. at install time.
      mouseBindingsPlugin(props.mouseBindings ? { overrides: props.mouseBindings } : {}),
      // Navigate depends on mouse-bindings, so it registers after it.
      navigatePlugin(),
      eraserPlugin(),
      // Point-placement tool — taps emit `point:picked` for new-anchor flows
      // (mobile new-finding gesture). Depends on mouse-bindings + selection.
      placementPlugin(),
      // Guided-pick overlay (dimming scrim + instruction banner) on top of
      // placement — hosts arm it via `interaction.request`. Depends on placement.
      interactionPlugin(),
      // Fly navigation — the first-person camera tool (WASD / D-pad + mouse-look).
      // Depends on camera + mouse-bindings (it suppresses selection/hover gestures
      // on enter), so it must register after mouse-bindings. Stays dormant until
      // the toolbar fly-out enables it.
      cameraFlyPlugin(props.cameraFly ?? {}),
      // Single authority over which pointer/camera tool is active (select /
      // navigate / eraser / fly). Depends on those four being registered first.
      toolManagerPlugin(),
      // Edit mode delegates click-action neutralization to tool-manager, so it
      // registers after it and disposes before it.
      modePlugin(),
      snappingPlugin(props.snapping ?? {}),
      contextMenuPlugin(),
      ...(viewCubeEnabled
        ? [
            viewCubePlugin({
              ...(viewCubeOpts?.size ? { size: viewCubeOpts.size } : {}),
              ...(viewCubeOpts?.locale ? { locale: viewCubeOpts.locale } : {}),
            }),
          ]
        : []),
      ...(props.pivotRotate === false
        ? []
        : [pivotRotatePlugin(props.pivotRotate ?? {})]),
      effectsPlugin(props.effects ?? {}),
      interactivePerformancePlugin(props.interactivePerformance ?? {}),
      // Native frustum culling policy (auto/on/off). Registers the
      // `performance.setCulling` command the portal's settings drive.
      performanceCullingPlugin(),
      ...(props.section !== false ? [sectionPlugin(typeof props.section === 'object' ? props.section : {})] : []),
      measurementPlugin(),
      wireframePlugin(),
      // Unified display-mode menu (normal / x-ray / monochrome / clay / matcap).
      // Registers after xrayPlugin (its delegate) — see its `dependencies`.
      displayModePlugin(),
      classifierPlugin(),
      // Minimap depends on classifier + visibility (both registered above) for
      // storey isolation; it owns the floor-plan↔model interaction surface.
      minimapPlugin(),
      itemsFinderPlugin(),
      boundingBoxerPlugin(),
      viewpointsPlugin(),
      markerPlugin(),
      entityMarkerPlugin(),
      gridPlugin(),
      screenshotPlugin(),
      bcfPlugin(),
      colorCodingPlugin(),
      exploderPlugin(),
      // Keyboard-shortcuts must install LAST among built-ins so it can
      // seed bindings from every command's `defaultShortcut` metadata.
      // Earlier placement caused navigate(3), eraser(4), screenshot(5),
      // snapping(S), and measure-axis-lock(A) shortcuts to be missed.
      keyboardShortcutsPlugin(shortcuts ? { overrides: shortcuts } : {}),
    ];

    // Plugin preset. 'full' (default) keeps every built-in — the portal's
    // experience is unchanged. 'minimal' is the snagging-only set (orbit +
    // tap-select + pins + tap-to-place) for the mobile embed: it filters the
    // ALREADY dependency-ordered `builtIns` by an allowlist, so the surviving
    // plugins keep their proven install order and every hard dependency is still
    // satisfied (see MINIMAL_BUILTIN_PLUGINS). This skips the install-time work
    // (event subscriptions, command registration, caches) and per-frame event
    // fan-out of ~16 unused plugins. NOTE: the dropped factories are still
    // statically imported above, so this is a runtime/memory win, not yet a
    // bundle-size win — that needs the full-only factories behind dynamic
    // imports (deliberately deferred).
    const preset = props.builtInPlugins ?? 'full';
    const selectedBuiltIns =
      preset === 'minimal'
        ? builtIns.filter((p) => MINIMAL_BUILTIN_PLUGINS.has(p.name))
        : builtIns;

    const viewer = new Viewer({
      plugins: [...selectedBuiltIns, ...userPlugins],
      ...(props.background ? { background: props.background } : {}),
      ...(props.shadows ? { shadows: props.shadows } : {}),
      ...(props.controls ? { controls: props.controls } : {}),
      ...(props.zoom ? { zoom: props.zoom } : {}),
      ...(props.graphicsQuality !== undefined
        ? { graphicsQuality: props.graphicsQuality }
        : {}),
      ...(props.autoCullElementThreshold !== undefined
        ? { autoCullElementThreshold: props.autoCullElementThreshold }
        : {}),
    });
    viewerRef.current = viewer;

    let cancelled = false;

    (async () => {
      try {
        await viewer.mount(container);
        if (cancelled) return;
        // The scene exists but holds NO model yet — the diff effect below loads
        // the full desired set (primary + extras) incrementally, frames once,
        // and fires onReady. `onSceneReady` signals only that the canvas/scene
        // is live (unchanged contract).
        props.onSceneReady?.();
        setMounted(true);
      } catch (err) {
        if (cancelled) return;
        // Always-on (ungated): the viewer couldn't mount — fatal, there is no
        // scene. Distinct from the chatty `vlog`/`vwarn`.
        verror('mount', 'viewer mount failed', err);
        props.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      setMounted(false);
      loadedRef.current = new Set();
      firstDiffRef.current = true;
      onReadyFiredRef.current = false;
      viewer.unmount().catch(() => undefined);
      viewerRef.current = null;
    };
    // MOUNT ONCE. The viewer instance lives for the component's lifetime; ALL
    // model load/unload is owned by the diff effect below, so swapping which
    // model is "primary" never reconstructs the viewer (that was the federated
    // full-reload bug). Option props (background/shadows/controls/zoom/plugins/…)
    // are read at mount time — unchanged from before, since they were never in
    // the dep array; hosts mutate plugins at runtime via handle.plugins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unified incremental load/unload: diff the FULL desired set (primary + extras)
  // against what's loaded and apply only the delta — no remount, camera
  // preserved. Any model (including the primary) can be added/removed alone.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null || !mounted) return undefined;

    const desired = buildDesired(props); // [{key, bundle}], primary at index 0
    const desiredMap = new Map(desired.map((d) => [d.key, d.bundle]));
    const loaded = loadedRef.current;
    const isFirstDiff = firstDiffRef.current;

    let cancelled = false;
    void (async () => {
      const mark = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
      const since = (t0: number): string => `${Math.round(mark() - t0)}ms`;

      const removed = [...loaded].filter((key) => !desiredMap.has(key));
      // Preserve desired order so the primary (index 0) loads FIRST — a fresh
      // viewer frames the camera on its first model (Viewer.loadFragments).
      const added = desired.filter((d) => !loaded.has(d.key));
      vlog('federate', 'diff desired set', {
        desired: desired.map((d) => d.key),
        loaded: [...loaded],
        added: added.map((d) => d.key),
        removed,
      });

      // Bracket the whole delta with onBusyChange so the host can show a loading
      // overlay during ANY model swap — not just the primary's initial download
      // that `onProgress` covers. `hasWork` skips no-op diffs.
      const hasWork = removed.length > 0 || added.length > 0;
      if (hasWork) props.onBusyChange?.(true);
      try {
        // Unload models no longer in the set. A failure must not wedge the model
        // in `loaded` (it would retry forever) — drop it and log.
        for (const key of removed) {
          const t0 = mark();
          try {
            await viewer.unloadModel(key);
            vlog('federate', `unloaded "${key}" (${since(t0)})`);
          } catch (err) {
            vwarn('federate', `unloadModel("${key}") failed`, err);
          }
          loaded.delete(key);
          if (cancelled) return;
        }

        // Load newly-added models. CRITICAL: each load is isolated so ONE failing
        // model can't reject the whole batch — a single bad bundle must never
        // abort the remaining loads AND the framing below, blanking the scene.
        // `onProgress` is the primary's concern on the INITIAL load only (extras
        // load quietly), matching the prior single-file behaviour.
        let anySucceeded = false;
        for (const { key, bundle } of added) {
          const isPrimary = bundle === props.bundle;
          const onProgress = isFirstDiff && isPrimary ? props.onProgress : undefined;
          const t0 = mark();
          try {
            await loadBundleInto(viewer, bundle, onProgress);
            loaded.add(key);
            anySucceeded = true;
            vlog('federate', `loaded "${key}" (${since(t0)})`);
          } catch (err) {
            // Always-on (ungated): a model failed to load. We skip it and keep the
            // rest of the scene — but the failure must be visible by default (not
            // hidden behind the viewer-debug gate like `vwarn`).
            verror('load', `model "${key}" failed to load — skipping`, err);
            props.onModelLoadError?.(key, err instanceof Error ? err : new Error(String(err)));
          }
          if (cancelled) return;
        }

        // First diff only: frame the whole initial set once (even if some models
        // failed) so a single bad model can never leave the scene unframed, then
        // fire onReady EXACTLY once. Later diffs preserve the camera and never
        // re-fire onReady/onError — they are pure incremental add/unload.
        if (isFirstDiff) {
          firstDiffRef.current = false;
          if (anySucceeded) {
            try {
              await viewer.commands.execute('camera.zoomExtents');
              vlog('federate', 'framed scene (camera.zoomExtents)');
            } catch (err) {
              vwarn('federate', 'camera.zoomExtents failed', err);
            }
            if (!onReadyFiredRef.current) {
              onReadyFiredRef.current = true;
              const handle = handleRef.current;
              if (handle) props.onReady?.(handle);
            }
          } else if (desired.length > 0) {
            // The initial desired set was non-empty but nothing loaded — fatal,
            // the scene is blank (matches the old "primary failed → onError").
            verror('load', 'initial model set failed to load — scene is empty');
            props.onError?.(new Error('No model could be loaded'));
          }
        }
      } finally {
        // Don't clear on cancellation — a superseding diff run owns the state and
        // will re-assert busy=true, so clearing here would flicker the overlay off.
        if (hasWork && !cancelled) props.onBusyChange?.(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, desiredKey]);

  return (
    <div
      ref={containerRef}
      className={props.className ?? ''}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  );
}

/**
 * Fetch the precomputed outline artifact, mirroring the fragments'
 * IndexedDB caching (compressed bytes, key `<cacheKey>.outline`). Never
 * throws — resolves null on any failure so the outline plugin falls back
 * to client-side edge extraction.
 */
async function fetchOutlineArtifact(
  url: string,
  cacheKey: string | undefined,
): Promise<Uint8Array | null> {
  try {
    const outlineKey = cacheKey ? `${cacheKey}.outline` : null;
    if (outlineKey) {
      const cached = await getCached(outlineKey);
      if (cached) return cached;
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return null;
    if (outlineKey) {
      putCached(outlineKey, bytes).catch(() => undefined);
    }
    return bytes;
  } catch {
    return null;
  }
}

export const IfcViewer = forwardRef<ViewerHandle, IfcViewerProps>(IfcViewerImpl);
IfcViewer.displayName = 'IfcViewer';
