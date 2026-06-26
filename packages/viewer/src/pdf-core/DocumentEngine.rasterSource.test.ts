// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentEngine } from './DocumentEngine.js';
import type { RasterDocument, RasterSource } from './rasterSource.js';

function makeFakeDoc(): RasterDocument {
  return {
    numPages: 3,
    getPageSize: vi.fn(async () => ({ width: 100, height: 200 })),
    renderPage: vi.fn(async () => ({
      buffer: {} as unknown as CanvasImageSource,
      bufW: 100,
      bufH: 200,
      cssW: 100,
      cssH: 200,
    })),
    destroy: vi.fn(async () => undefined),
  };
}

function makeElements() {
  const el = (tag: string): HTMLElement => document.createElement(tag);
  return {
    container: el('div'),
    canvas: el('canvas') as HTMLCanvasElement,
    textLayer: el('div'),
    overlayHost: el('div'),
    webglHost: el('div'),
    viewportOverlay: el('div'),
  };
}

describe('DocumentEngine + RasterSource (source-agnostic flow)', () => {
  beforeEach(() => {
    // happy-dom's 2D context isn't a real canvas; skip the blit safely.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drives load → open → getPageSize → renderPage and emits doc:loaded + page:rendered', async () => {
    const fakeDoc = makeFakeDoc();
    const source: RasterSource = { open: vi.fn(async () => fakeDoc) };
    const engine = new DocumentEngine({ rasterSource: source });
    await engine.mount(makeElements());

    const loaded = vi.fn();
    const rendered = vi.fn();
    engine.events.on('doc:loaded', loaded);
    engine.events.on('page:rendered', rendered);

    await engine.load('http://x/manifest.json');

    expect(source.open).toHaveBeenCalledWith('http://x/manifest.json', expect.any(Function));
    expect(loaded).toHaveBeenCalledWith({ numPages: 3 });
    expect(fakeDoc.getPageSize).toHaveBeenCalled();
    expect(fakeDoc.renderPage).toHaveBeenCalled();
    expect(rendered).toHaveBeenCalledTimes(1);

    await engine.unmount();
    expect(fakeDoc.destroy).toHaveBeenCalled();
  });

  it('emits doc:error and renders nothing when no rasterSource is provided', async () => {
    const engine = new DocumentEngine({}); // floor-plan-only configuration
    await engine.mount(makeElements());

    const error = vi.fn();
    const rendered = vi.fn();
    engine.events.on('doc:error', error);
    engine.events.on('page:rendered', rendered);

    await engine.load('http://x/whatever.pdf');

    expect(error).toHaveBeenCalledTimes(1);
    expect(rendered).not.toHaveBeenCalled();

    await engine.unmount();
  });
});
