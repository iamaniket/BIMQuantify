/**
 * Bounded-concurrency page extraction must preserve page order, release every
 * page's pdfjs resources via cleanup(), and report progress per completed page.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/pipeline/pdf-geometry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pipeline/pdf-geometry.js')>();
  return {
    ...actual,
    buildPageGeometry: vi.fn(async (_page: unknown, idx: number) => ({
      i: idx,
      w: 0,
      h: 0,
      l: [],
      t: [],
    })),
  };
});

const { extractPagesConcurrently } = await import('../src/pipeline/pdf.js');

describe('extractPagesConcurrently', () => {
  it('preserves page order, cleans up every page, and reports per-page progress', async () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    const doc = {
      getPage: vi.fn(async (_n: number) => {
        const cleanup = vi.fn();
        cleanups.push(cleanup);
        return { cleanup };
      }),
    };
    const progress: number[] = [];
    const pages = await extractPagesConcurrently(doc as never, 5, 2, (done) => {
      progress.push(done);
    });

    expect(pages.map((p) => p.i)).toEqual([0, 1, 2, 3, 4]);
    expect(cleanups).toHaveLength(5);
    for (const c of cleanups) expect(c).toHaveBeenCalledTimes(1);
    // One progress tick per page; the final tick reports all pages done.
    expect(progress).toHaveLength(5);
    expect(Math.max(...progress)).toBe(5);
  });

  it('still works with a single lane (serial)', async () => {
    const doc = { getPage: vi.fn(async () => ({ cleanup: vi.fn() })) };
    const pages = await extractPagesConcurrently(doc as never, 3, 1);
    expect(pages.map((p) => p.i)).toEqual([0, 1, 2]);
  });
});
