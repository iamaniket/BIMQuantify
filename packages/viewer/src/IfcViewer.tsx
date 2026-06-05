'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
  type JSX,
} from 'react';

import { Viewer } from './core/Viewer.js';
import { getCached, putCached } from './fragmentCache.js';
import { fetchFragments } from './loadFragments.js';
import { cameraPlugin } from './plugins/3d/camera/index.js';
import { effectsPlugin } from './plugins/3d/effects/index.js';
import { hoverHighlightPlugin } from './plugins/3d/hover-highlight/index.js';
import { interactivePerformancePlugin } from './plugins/3d/interactive-performance/index.js';
import { keyboardShortcutsPlugin } from './plugins/3d/keyboard-shortcuts/index.js';
import { mouseBindingsPlugin } from './plugins/3d/mouse-bindings/index.js';
import { navigatePlugin } from './plugins/3d/navigate/index.js';
import { pivotRotatePlugin } from './plugins/3d/pivot-rotate/index.js';
import { selectionPlugin } from './plugins/3d/selection/index.js';
import { viewCubePlugin } from './plugins/3d/viewcube/index.js';
import { visibilityPlugin } from './plugins/3d/visibility/index.js';
import { inspectPlugin } from './plugins/3d/inspect/index.js';
import { eraserPlugin } from './plugins/3d/eraser/index.js';
import { contextMenuPlugin } from './plugins/3d/context-menu/index.js';
import { xrayPlugin } from './plugins/3d/xray/index.js';
import { outlinePlugin } from './plugins/3d/outline/index.js';
import { modePlugin } from './plugins/3d/mode/index.js';
import { sectionPlugin } from './plugins/3d/section/index.js';
import { measurementPlugin } from './plugins/3d/measurement/index.js';
import { walkthroughPlugin } from './plugins/3d/walkthrough/index.js';
import { snappingPlugin } from './plugins/3d/snapping/index.js';
import { wireframePlugin } from './plugins/3d/wireframe/index.js';
import { classifierPlugin } from './plugins/3d/classifier/index.js';
import { itemsFinderPlugin } from './plugins/3d/items-finder/index.js';
import { boundingBoxerPlugin } from './plugins/3d/bounding-boxer/index.js';
import { viewpointsPlugin } from './plugins/3d/viewpoints/index.js';
import { markerPlugin } from './plugins/3d/marker/index.js';
import { gridPlugin } from './plugins/3d/grid/index.js';
import { screenshotPlugin } from './plugins/3d/screenshot/index.js';
import { colorCodingPlugin } from './plugins/3d/color-coding/index.js';
import { exploderPlugin } from './plugins/3d/exploder/index.js';
import type { IfcViewerProps, ViewerHandle } from './types.js';

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
    };
    handleRef.current = handle;
    return handle;
  }, []);

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
      modePlugin(),
      outlinePlugin(props.outline ?? {}),
      xrayPlugin(),
      // Mouse-bindings registers AFTER selection/hover so the default
      // bindings can resolve `selection.pickSet` etc. at install time.
      mouseBindingsPlugin(props.mouseBindings ? { overrides: props.mouseBindings } : {}),
      // Navigate depends on mouse-bindings, so it registers after it.
      navigatePlugin(),
      eraserPlugin(),
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
      ...(props.section !== false ? [sectionPlugin(typeof props.section === 'object' ? props.section : {})] : []),
      measurementPlugin(),
      ...(props.walkthrough !== false ? [walkthroughPlugin(typeof props.walkthrough === 'object' ? props.walkthrough : {})] : []),
      wireframePlugin(),
      classifierPlugin(),
      itemsFinderPlugin(),
      boundingBoxerPlugin(),
      viewpointsPlugin(),
      markerPlugin(),
      gridPlugin(),
      screenshotPlugin(),
      colorCodingPlugin(),
      exploderPlugin(),
      // Keyboard-shortcuts must install LAST among built-ins so it can
      // seed bindings from every command's `defaultShortcut` metadata.
      // Earlier placement caused navigate(3), eraser(4), screenshot(5),
      // snapping(S), and measure-axis-lock(A) shortcuts to be missed.
      keyboardShortcutsPlugin(shortcuts ? { overrides: shortcuts } : {}),
    ];

    const viewer = new Viewer({
      plugins: [...builtIns, ...userPlugins],
      ...(props.background ? { background: props.background } : {}),
      ...(props.shadows ? { shadows: props.shadows } : {}),
      ...(props.controls ? { controls: props.controls } : {}),
      ...(props.zoom ? { zoom: props.zoom } : {}),
    });
    viewerRef.current = viewer;

    let cancelled = false;

    (async () => {
      try {
        await viewer.mount(container);
        if (cancelled) return;
        props.onSceneReady?.();
        const cacheKey = props.bundle.cacheKey;
        let bytes: Uint8Array | null = null;
        if (cacheKey) {
          bytes = await getCached(cacheKey);
        }
        if (bytes === null) {
          bytes = await fetchFragments(
            props.bundle.fragmentsUrl,
            props.onProgress,
          );
          if (cacheKey && bytes.byteLength > 0) {
            putCached(cacheKey, bytes).catch(() => undefined);
          }
        }
        if (cancelled) return;
        await viewer.loadFragments(bytes);
        if (cancelled) return;
        const handle = handleRef.current;
        if (handle) props.onReady?.(handle);
      } catch (err) {
        if (cancelled) return;
        props.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      viewer.unmount().catch(() => undefined);
      viewerRef.current = null;
    };
    // The bundle URL is the only thing we re-mount for; everything else
    // (callbacks, plugin lists, shortcuts) is read at mount time. Hosts
    // wanting to swap plugins at runtime should use `handle.plugins.*`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bundle.fragmentsUrl]);

  return (
    <div
      ref={containerRef}
      className={props.className ?? ''}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  );
}

export const IfcViewer = forwardRef<ViewerHandle, IfcViewerProps>(IfcViewerImpl);
IfcViewer.displayName = 'IfcViewer';
