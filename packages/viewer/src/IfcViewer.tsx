'use client';

import { useEffect, useRef, type JSX } from 'react';

import { fetchFragments } from './loadFragments.js';
import { ThatOpenScene } from './ThatOpenScene.js';
import type { IfcViewerProps } from './types.js';

/**
 * Headless React wrapper around `ThatOpenScene`. Renders a fullsize <div>
 * that the scene mounts itself into. The component intentionally has no
 * controls, no toolbar, no panels — keeping it minimum so swapping the
 * underlying library to xeokit later means rewriting just `ThatOpenScene`,
 * not this file.
 */
export function IfcViewer(props: IfcViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ThatOpenScene | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    const scene = new ThatOpenScene();
    sceneRef.current = scene;

    let cancelled = false;

    (async () => {
      try {
        scene.mount(container);
        const bytes = await fetchFragments(props.bundle.fragmentsUrl);
        if (cancelled) return;
        await scene.loadFragments(bytes);
        if (cancelled) return;
        props.onReady?.();
      } catch (err) {
        if (cancelled) return;
        props.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      scene.unmount();
      sceneRef.current = null;
    };
    // The bundle URLs are the only thing we react to; callbacks are stable
    // because the host typically wraps them in useCallback.
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
