'use client';

import {
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type DocumentLoadedInfo = {
  numPages: number;
};

export type DocumentViewerProps = {
  fileUrl: string;
  currentPage: number;
  scale?: number;
  className?: string;
  onLoaded?: (info: DocumentLoadedInfo) => void;
  onError?: (err: Error) => void;
};

export function DocumentViewer({
  fileUrl,
  currentPage,
  scale = 1.0,
  className,
  onLoaded,
  onError,
}: DocumentViewerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pageRef = useRef<pdfjsLib.PDFPageProxy | null>(null);
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  // Stable callback refs so effects don't re-run when parent passes new closures.
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
  });

  // Load the PDF document. disableAutoFetch ensures PDF.js streams pages on demand
  // via HTTP Range requests instead of fetching the whole file up front.
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
    };
  }, [fileUrl]);

  // Render the active page whenever currentPage, scale, or the doc changes.
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

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const viewport = page.getViewport({ scale });
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
  }, [doc, currentPage, scale]);

  return (
    <div
      className={className}
      style={{
        overflow: 'auto',
        background: '#f3f4f6',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '16px',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
      />
    </div>
  );
}
