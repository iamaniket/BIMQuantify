// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageRasterSource } from './ImageRasterSource.js';

const MANIFEST = {
  pages: [
    { index: 0, pageWidth: 100, pageHeight: 200, imageWidth: 400, imageHeight: 800, url: 'http://x/p0.webp' },
    { index: 1, pageWidth: 50, pageHeight: 70, imageWidth: 200, imageHeight: 280, url: 'http://x/p1.webp' },
  ],
};

function mockFetch(manifest: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => manifest,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImageRasterSource', () => {
  it('parses the manifest and reports the page count', async () => {
    vi.stubGlobal('fetch', mockFetch(MANIFEST));
    const doc = await imageRasterSource.open('http://x/manifest.json');
    expect(doc.numPages).toBe(2);
  });

  it('reports PDF-point page size, swapping width/height on 90/270 rotation', async () => {
    vi.stubGlobal('fetch', mockFetch(MANIFEST));
    const doc = await imageRasterSource.open('http://x/manifest.json');
    expect(await doc.getPageSize(1, 0)).toEqual({ width: 100, height: 200 });
    expect(await doc.getPageSize(1, 180)).toEqual({ width: 100, height: 200 });
    expect(await doc.getPageSize(1, 90)).toEqual({ width: 200, height: 100 });
    expect(await doc.getPageSize(1, 270)).toEqual({ width: 200, height: 100 });
  });

  it('exposes no text capability — search degrades to a no-op', async () => {
    vi.stubGlobal('fetch', mockFetch(MANIFEST));
    const doc = await imageRasterSource.open('http://x/manifest.json');
    expect(doc.getPageText).toBeUndefined();
    expect(doc.renderTextLayer).toBeUndefined();
  });

  it('throws when the manifest response is not ok', async () => {
    vi.stubGlobal('fetch', mockFetch(null, false, 404));
    await expect(imageRasterSource.open('http://x/missing.json')).rejects.toThrow(/manifest/i);
  });

  it('throws when the manifest has no pages', async () => {
    vi.stubGlobal('fetch', mockFetch({ pages: [] }));
    await expect(imageRasterSource.open('http://x/empty.json')).rejects.toThrow(/no pages/i);
  });
});
