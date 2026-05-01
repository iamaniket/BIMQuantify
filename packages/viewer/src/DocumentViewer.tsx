'use client';

import {
  useCallback,
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

export type DocumentViewerProps = {
  fileUrl: string;
  className?: string;
  onReady?: () => void;
  onError?: (err: Error) => void;
};

export function DocumentViewer({
  fileUrl,
  className,
  onReady,
  onError,
}: DocumentViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const renderPages = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, renderScale: number) => {
    const container = containerRef.current;
    if (container === null) return;
    container.innerHTML = '';

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
      canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto 16px auto';
      canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)';

      const ctx = canvas.getContext('2d');
      if (ctx === null) continue;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      container.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const doc = await pdfjsLib.getDocument(fileUrl).promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setLoading(false);
        await renderPages(doc, scale);
        onReady?.();
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDocRef.current !== null) {
        pdfDocRef.current.destroy().catch(() => undefined);
        pdfDocRef.current = null;
      }
    };
    // only re-run when fileUrl changes, not on scale/renderPages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  useEffect(() => {
    if (pdfDocRef.current !== null) {
      renderPages(pdfDocRef.current, scale).catch(() => undefined);
    }
  }, [scale, renderPages]);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border, #e5e7eb)',
          background: 'var(--background, #fff)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
          style={{ padding: '4px 8px', cursor: 'pointer' }}
          aria-label="Zoom out"
        >
          −
        </button>
        <span style={{ fontSize: '13px', minWidth: '48px', textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(4, s + 0.25))}
          style={{ padding: '4px 8px', cursor: 'pointer' }}
          aria-label="Zoom in"
        >
          +
        </button>
        {pageCount > 0 ? (
          <span style={{ fontSize: '13px', color: '#6b7280', marginLeft: '8px' }}>
            {pageCount} page{pageCount !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          background: '#f3f4f6',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
            Loading document…
          </div>
        ) : null}
      </div>
    </div>
  );
}
