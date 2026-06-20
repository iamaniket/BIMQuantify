import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawAnnotation, exportAnnotatedImage } from './export.js';
import type { RenderBox } from './shapes.js';
import type { Annotation2D } from './types.js';

const BOX: RenderBox = { width: 800, height: 600 };

/** A recording stub of the Canvas2D methods `drawAnnotation` touches. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string) => (..._a: unknown[]) => { calls.push(name); };
  const ctx = {
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    closePath: rec('closePath'),
    stroke: rec('stroke'),
    strokeRect: rec('strokeRect'),
    ellipse: rec('ellipse'),
    fillText: rec('fillText'),
    drawImage: rec('drawImage'),
    canvas: {},
    imageSmoothingEnabled: true,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function ann(tool: Annotation2D['tool'], text?: string): Annotation2D {
  return {
    id: tool,
    tool,
    points: tool === 'text' ? [[0.3, 0.3]] : [[0.2, 0.2], [0.7, 0.6]],
    text,
    color: '#ef4444',
    strokeWidth: 6,
  };
}

describe('drawAnnotation', () => {
  it('strokes a rectangle', () => {
    const { ctx, calls } = fakeCtx();
    drawAnnotation(ctx, ann('rect'), BOX);
    expect(calls).toContain('strokeRect');
  });

  it('draws an ellipse path', () => {
    const { ctx, calls } = fakeCtx();
    drawAnnotation(ctx, ann('ellipse'), BOX);
    expect(calls).toContain('ellipse');
    expect(calls).toContain('stroke');
  });

  it.each(['line', 'arrow', 'cloud', 'freehand'] as const)('strokes a %s', (tool) => {
    const { ctx, calls } = fakeCtx();
    const a = tool === 'freehand'
      ? { ...ann(tool), points: [[0, 0], [0.1, 0.1], [0.2, 0.05]] as [number, number][] }
      : ann(tool);
    drawAnnotation(ctx, a, BOX);
    expect(calls).toContain('stroke');
  });

  it('fills text', () => {
    const { ctx, calls } = fakeCtx();
    drawAnnotation(ctx, ann('text', 'hi'), BOX);
    expect(calls).toContain('fillText');
  });

  it('does not throw for a blur region', () => {
    const { ctx } = fakeCtx();
    expect(() => { drawAnnotation(ctx, ann('blur'), BOX); }).not.toThrow();
  });
});

describe('exportAnnotatedImage', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('produces a Blob of the requested MIME type', async () => {
    const { ctx } = fakeCtx();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void, mime: string) => { cb(new Blob(['x'], { type: mime })); },
    };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      (tag === 'canvas' ? canvas : {})) as typeof document.createElement);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob([]) })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600 })));

    const blob = await exportAnnotatedImage('https://example.test/photo.jpg', [ann('rect')], {
      mimeType: 'image/png',
    });
    expect(blob.type).toBe('image/png');
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('downscales when maxEdge is set', async () => {
    const { ctx } = fakeCtx();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void, mime: string) => { cb(new Blob(['x'], { type: mime })); },
    };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      (tag === 'canvas' ? canvas : {})) as typeof document.createElement);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob([]) })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 1000 })));

    await exportAnnotatedImage('https://example.test/photo.jpg', [], { maxEdge: 1000 });
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(500);
  });
});
