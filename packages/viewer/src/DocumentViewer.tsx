'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type DocumentLoadedInfo = {
  numPages: number;
};

export type DocumentActiveTool = 'select' | 'pan' | 'zoom';
export type DocumentRotation = 0 | 90 | 180 | 270;

export type DocumentViewerHandle = {
  zoomIn(): void;
  zoomOut(): void;
  /** Set scale directly. If `originClient` is provided, zoom keeps that client point stable. */
  zoomTo(scale: number, originClient?: { x: number; y: number }): void;
  /** Fit current page entirely inside the viewport. */
  fitPage(): void;
  /** Fit current page width to the viewport width. */
  fitWidth(): void;
  /** Reset to 100%. */
  actualSize(): void;
  /** Rotate by ±90°. */
  rotateBy(deg: 90 | -90): void;
};

export type DocumentViewerProps = {
  fileUrl: string;
  currentPage: number;
  scale?: number;
  rotation?: DocumentRotation;
  activeTool?: DocumentActiveTool;
  className?: string;
  onLoaded?: (info: DocumentLoadedInfo) => void;
  onError?: (err: Error) => void;
  onScaleChange?: (scale: number) => void;
  onRotationChange?: (rotation: DocumentRotation) => void;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const SCALE_STEP = 0.25;
const FIT_PADDING = 24; // px of breathing room around the page when fitting.

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function rotateDelta(rot: DocumentRotation, delta: 90 | -90): DocumentRotation {
  const next = (rot + delta + 360) % 360;
  return next as DocumentRotation;
}

function DocumentViewerInner(
  {
    fileUrl,
    currentPage,
    scale = 1.0,
    rotation = 0,
    activeTool = 'select',
    className,
    onLoaded,
    onError,
    onScaleChange,
    onRotationChange,
  }: DocumentViewerProps,
  ref: ForwardedRef<DocumentViewerHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pageRef = useRef<pdfjsLib.PDFPageProxy | null>(null);
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [unscaledViewport, setUnscaledViewport] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Live refs so the handle / event listeners always read current values
  // without stale closures.
  const scaleRef = useRef(scale);
  const rotationRef = useRef<DocumentRotation>(rotation);
  const onScaleChangeRef = useRef(onScaleChange);
  const onRotationChangeRef = useRef(onRotationChange);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    scaleRef.current = scale;
    rotationRef.current = rotation;
    onScaleChangeRef.current = onScaleChange;
    onRotationChangeRef.current = onRotationChange;
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
  });

  // Pan-drag state. We use document-level pointermove/up so the drag survives
  // the pointer leaving the canvas.
  const dragRef = useRef<
    | {
        active: boolean;
        startX: number;
        startY: number;
        scrollLeft: number;
        scrollTop: number;
        pointerId: number;
      }
    | null
  >(null);

  // ---- Load the PDF ----
  useEffect(() => {
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;

    (async () => {
      try {
        const task = pdfjsLib.getDocument({
          url: fileUrl,
          disableAutoFetch: true,
          disableStream: false,
        });
        const newDoc = await task.promise;
        if (cancelled) {
          await newDoc.destroy();
          return;
        }
        loaded = newDoc;
        setDoc(newDoc);
        onLoadedRef.current?.({ numPages: newDoc.numPages });
      } catch (err) {
        if (cancelled) return;
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current !== null) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pageRef.current !== null) {
        pageRef.current.cleanup();
        pageRef.current = null;
      }
      if (loaded !== null) {
        loaded.destroy().catch(() => undefined);
      }
      setDoc(null);
      setUnscaledViewport(null);
    };
  }, [fileUrl]);

  // ---- Render the active page when page/scale/rotation/doc change ----
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (canvas === null || doc === null) return undefined;

    (async () => {
      if (renderTaskRef.current !== null) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pageRef.current !== null) {
        pageRef.current.cleanup();
        pageRef.current = null;
      }

      try {
        const safePage = Math.min(Math.max(1, currentPage), doc.numPages);
        const page = await doc.getPage(safePage);
        if (cancelled) {
          page.cleanup();
          return;
        }
        pageRef.current = page;

        // Track the unscaled viewport so fit-page/fit-width math works.
        const base = page.getViewport({ scale: 1, rotation });
        setUnscaledViewport({ width: base.width, height: base.height });

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const viewport = page.getViewport({ scale, rotation });
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (ctx === null) return;

        const task = page.render({
          canvasContext: ctx,
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) {
          renderTaskRef.current = null;
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as { name?: string };
        if (e?.name === 'RenderingCancelledException') return;
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, currentPage, scale, rotation]);

  // ---- Imperative handle ----
  const setScalePreserveOrigin = useCallback(
    (next: number, origin?: { x: number; y: number }): void => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const target = clampScale(next);
      const current = scaleRef.current;
      if (target === current) return;

      let nextScrollLeft: number | null = null;
      let nextScrollTop: number | null = null;
      if (container && canvas && origin) {
        const rect = canvas.getBoundingClientRect();
        // Position of the cursor inside the unscaled canvas content.
        const xOnCanvas = origin.x - rect.left;
        const yOnCanvas = origin.y - rect.top;
        const ratio = target / current;
        // After scaling, the same content point lives at (x*ratio, y*ratio).
        // Adjust scroll so it stays under the cursor's screen position.
        const cRect = container.getBoundingClientRect();
        const cursorInContainerX = origin.x - cRect.left;
        const cursorInContainerY = origin.y - cRect.top;
        nextScrollLeft = xOnCanvas * ratio - cursorInContainerX + (canvas.offsetLeft * ratio);
        nextScrollTop = yOnCanvas * ratio - cursorInContainerY + (canvas.offsetTop * ratio);
      }

      onScaleChangeRef.current?.(target);

      // Apply scroll *after* React renders the new size. Use rAF so the canvas
      // has been resized by then.
      if (container && (nextScrollLeft !== null || nextScrollTop !== null)) {
        requestAnimationFrame(() => {
          if (nextScrollLeft !== null) container.scrollLeft = nextScrollLeft;
          if (nextScrollTop !== null) container.scrollTop = nextScrollTop;
        });
      }
    },
    [],
  );

  const fitToViewport = useCallback(
    (mode: 'page' | 'width'): void => {
      const container = containerRef.current;
      if (!container || !unscaledViewport) return;
      const availW = Math.max(1, container.clientWidth - FIT_PADDING * 2);
      const availH = Math.max(1, container.clientHeight - FIT_PADDING * 2);
      const sx = availW / unscaledViewport.width;
      const sy = availH / unscaledViewport.height;
      const next = mode === 'page' ? Math.min(sx, sy) : sx;
      onScaleChangeRef.current?.(clampScale(next));
    },
    [unscaledViewport],
  );

  useImperativeHandle(
    ref,
    (): DocumentViewerHandle => ({
      zoomIn: () => {
        setScalePreserveOrigin(scaleRef.current + SCALE_STEP);
      },
      zoomOut: () => {
        setScalePreserveOrigin(scaleRef.current - SCALE_STEP);
      },
      zoomTo: (s, origin) => {
        setScalePreserveOrigin(s, origin);
      },
      fitPage: () => {
        fitToViewport('page');
      },
      fitWidth: () => {
        fitToViewport('width');
      },
      actualSize: () => {
        setScalePreserveOrigin(1);
      },
      rotateBy: (deg) => {
        const next = rotateDelta(rotationRef.current, deg);
        onRotationChangeRef.current?.(next);
      },
    }),
    [setScalePreserveOrigin, fitToViewport],
  );

  // ---- Wheel: Ctrl/Meta zooms toward cursor; otherwise default scroll. ----
  const handleWheel = useCallback(
    (ev: ReactWheelEvent<HTMLDivElement>): void => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const delta = ev.deltaY;
      // Smaller step than the toolbar buttons; tied to wheel magnitude.
      const factor = Math.exp(-delta * 0.0015);
      const next = clampScale(scaleRef.current * factor);
      setScalePreserveOrigin(next, { x: ev.clientX, y: ev.clientY });
    },
    [setScalePreserveOrigin],
  );

  // Chrome/Firefox fire wheel on the container with ctrlKey for trackpad pinch
  // too — but only if we use a non-passive listener. React's onWheel is
  // passive by default on some setups, so attach a native listener for safety.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onNative = (ev: WheelEvent): void => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const next = clampScale(scaleRef.current * factor);
      setScalePreserveOrigin(next, { x: ev.clientX, y: ev.clientY });
    };
    el.addEventListener('wheel', onNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onNative);
    };
  }, [setScalePreserveOrigin]);

  // ---- Pan-drag (Pan tool, or middle mouse anywhere) ----
  const beginDrag = useCallback(
    (clientX: number, clientY: number, pointerId: number): void => {
      const el = containerRef.current;
      if (!el) return;
      dragRef.current = {
        active: true,
        startX: clientX,
        startY: clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        pointerId,
      };
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // ignore — capture is a hint
      }
    },
    [],
  );

  const handlePointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      const isMiddle = ev.button === 1;
      const isLeftPanTool = ev.button === 0 && activeTool === 'pan';
      if (!isMiddle && !isLeftPanTool) return;
      ev.preventDefault();
      beginDrag(ev.clientX, ev.clientY, ev.pointerId);
    },
    [activeTool, beginDrag],
  );

  const handlePointerMove = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !drag.active || !el) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      el.scrollLeft = drag.scrollLeft - dx;
      el.scrollTop = drag.scrollTop - dy;
    },
    [],
  );

  const endDrag = useCallback((ev: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    try {
      el.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }
    dragRef.current = null;
    void ev;
  }, []);

  // ---- Click-zoom (Zoom tool) ----
  const handleClick = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      if (activeTool !== 'zoom') return;
      // ev.button: 0 = left, 2 = right. Alt+left = zoom out.
      const out = ev.altKey || ev.button === 2;
      const factor = out ? 1 / 1.25 : 1.25;
      const next = clampScale(scaleRef.current * factor);
      setScalePreserveOrigin(next, { x: ev.clientX, y: ev.clientY });
    },
    [activeTool, setScalePreserveOrigin],
  );

  // ---- Double-click: fit page (a familiar PDF gesture) ----
  const handleDoubleClick = useCallback((): void => {
    if (activeTool === 'pan' || activeTool === 'zoom') {
      fitToViewport('page');
    }
  }, [activeTool, fitToViewport]);

  // Cursor reflects the active tool.
  const cursor: CSSProperties['cursor'] =
    activeTool === 'pan' ? 'grab' : activeTool === 'zoom' ? 'zoom-in' : 'default';
  const dragging = dragRef.current?.active === true;

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="document-viewer"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(ev) => {
        if (activeTool === 'zoom') ev.preventDefault();
      }}
      style={{
        overflow: 'auto',
        background: '#f3f4f6',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '16px',
        cursor: dragging ? 'grabbing' : cursor,
        userSelect: activeTool === 'pan' ? 'none' : 'auto',
        touchAction: 'pan-x pan-y',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          // Disable image dragging; we own pan via pointer events.
          pointerEvents: activeTool === 'pan' ? 'none' : 'auto',
        }}
      />
    </div>
  );
}

export const DocumentViewer = forwardRef<DocumentViewerHandle, DocumentViewerProps>(
  DocumentViewerInner,
);
DocumentViewer.displayName = 'DocumentViewer';
