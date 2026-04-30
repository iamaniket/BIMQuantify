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
import { fetchFragments } from './loadFragments.js';
import { cameraPlugin } from './plugins/camera/index.js';
import { effectsPlugin } from './plugins/effects/index.js';
import { hoverHighlightPlugin } from './plugins/hover-highlight/index.js';
import { keyboardShortcutsPlugin } from './plugins/keyboard-shortcuts/index.js';
import { mouseBindingsPlugin } from './plugins/mouse-bindings/index.js';
import { selectionPlugin } from './plugins/selection/index.js';
import { viewCubePlugin } from './plugins/viewcube/index.js';
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
      hoverHighlightPlugin(),
      selectionPlugin(),
      keyboardShortcutsPlugin(shortcuts ? { overrides: shortcuts } : {}),
      // Mouse-bindings registers AFTER selection/hover so the default
      // bindings can resolve `selection.pickSet` etc. at install time.
      mouseBindingsPlugin(props.mouseBindings ? { overrides: props.mouseBindings } : {}),
      ...(viewCubeEnabled
        ? [
            viewCubePlugin({
              ...(viewCubeOpts?.corner ? { corner: viewCubeOpts.corner } : {}),
              ...(viewCubeOpts?.size ? { size: viewCubeOpts.size } : {}),
            }),
          ]
        : []),
      effectsPlugin(props.effects ?? {}),
    ];

    const viewer = new Viewer({
      plugins: [...builtIns, ...userPlugins],
      ...(props.background ? { background: props.background } : {}),
      ...(props.shadows ? { shadows: props.shadows } : {}),
      ...(props.controls ? { controls: props.controls } : {}),
    });
    viewerRef.current = viewer;

    let cancelled = false;

    (async () => {
      try {
        await viewer.mount(container);
        const bytes = await fetchFragments(props.bundle.fragmentsUrl);
        if (cancelled) return;
        await viewer.loadFragments(bytes);
        if (cancelled) return;
        // Make sure the handle is materialised before firing onReady.
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
