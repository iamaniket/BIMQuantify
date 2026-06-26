import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';

import { renderPdfPages, type RasterizeOptions } from '../src/pipeline/pdf-rasterize.js';

const OPTS: RasterizeOptions = { dpi: 96, maxEdgePx: 4096, quality: 80, concurrency: 2 };

/** WebP files are a RIFF container with a 'WEBP' fourCC at byte 8. */
function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

async function makePdf(sizes: [number, number][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont('Helvetica');
  sizes.forEach(([w, h], i) => {
    const page = pdf.addPage([w, h]);
    page.drawLine({ start: { x: 10, y: 10 }, end: { x: w - 10, y: h - 10 }, thickness: 2, color: rgb(0, 0, 0) });
    page.drawText(`Page ${String(i + 1)}`, { x: 20, y: h - 30, size: 12, font });
  });
  return pdf.save();
}

describe('renderPdfPages', () => {
  it('rasterizes every page to a WebP, preserving order and PDF-point page size', async () => {
    const bytes = await makePdf([
      [200, 300],
      [400, 200],
    ]);
    const pages = await renderPdfPages(bytes, OPTS);

    expect(pages).toHaveLength(2);

    expect(pages[0]?.index).toBe(0);
    expect(pages[0]?.pageWidth).toBeCloseTo(200, 0);
    expect(pages[0]?.pageHeight).toBeCloseTo(300, 0);
    expect(pages[1]?.index).toBe(1);
    expect(pages[1]?.pageWidth).toBeCloseTo(400, 0);
    expect(pages[1]?.pageHeight).toBeCloseTo(200, 0);

    for (const p of pages) {
      expect(isWebp(p.webp)).toBe(true);
      expect(p.imageWidth).toBeGreaterThan(0);
      expect(p.imageHeight).toBeGreaterThan(0);
    }

    // At 96 DPI (scale = 96/72 = 1.333…), a 200pt-wide page → ~267px.
    expect(pages[0]?.imageWidth).toBeCloseTo(Math.round(200 * (96 / 72)), -1);
  });

  it('caps the long edge at maxEdgePx for very large pages', async () => {
    // 5000pt long edge at 96 DPI would be ~6667px; cap at 1000px.
    const bytes = await makePdf([[5000, 1000]]);
    const pages = await renderPdfPages(bytes, { ...OPTS, maxEdgePx: 1000 });
    expect(pages).toHaveLength(1);
    expect(Math.max(pages[0]?.imageWidth ?? 0, pages[0]?.imageHeight ?? 0)).toBeLessThanOrEqual(1000);
    // The page-point size is unchanged (only the raster is capped).
    expect(pages[0]?.pageWidth).toBeCloseTo(5000, 0);
  });

  it('renders a single-page document', async () => {
    const bytes = await makePdf([[150, 150]]);
    const pages = await renderPdfPages(bytes, OPTS);
    expect(pages).toHaveLength(1);
    expect(isWebp(pages[0]!.webp)).toBe(true);
  });
});
