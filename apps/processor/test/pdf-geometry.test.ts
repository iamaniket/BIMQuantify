import { describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, rgb } from 'pdf-lib';

import {
  buildPageGeometry,
  extractTextItems,
  walkOperatorList,
  type RawOpList,
  type TextContentLike,
  type ViewBox,
} from '../src/pipeline/pdf-geometry.js';

/** Build a single-op constructPath entry. */
function constructPath(subOps: number[], coords: number[]): [number[], number[], number[]] {
  return [subOps, coords, [0, 0, 0, 0]];
}

describe('walkOperatorList', () => {
  const VB: ViewBox = [0, 0, 1000, 1000];

  it('applies the CTM and emits stroke width when outside the hairline band', () => {
    // transform [2,0,0,3,10,20] then a horizontal line (0,0)->(5,0).
    const opList: RawOpList = {
      fnArray: [OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.stroke],
      argsArray: [
        [2, 0, 0, 3, 10, 20],
        1,
        constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 5, 0]),
        null,
      ],
    };
    const lines = walkOperatorList(opList, VB);
    // (0,0) -> [10,20]; (5,0) -> [20,20]. scale = sqrt(|2*3|) = 2.449 -> w=2.45.
    expect(lines).toEqual([[10, 20, 20, 20, 2.45]]);
  });

  it('omits stroke width inside the hairline band', () => {
    const opList: RawOpList = {
      fnArray: [OPS.setLineWidth, OPS.constructPath, OPS.stroke],
      argsArray: [1, constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 5, 0]), null],
    };
    expect(walkOperatorList(opList, VB)).toEqual([[0, 0, 5, 0]]);
  });

  it('expands a rectangle into four closing segments', () => {
    const opList: RawOpList = {
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [constructPath([OPS.rectangle], [10, 10, 20, 30]), null],
    };
    expect(walkOperatorList(opList, VB)).toEqual([
      [10, 10, 30, 10],
      [30, 10, 30, 40],
      [30, 40, 10, 40],
      [10, 40, 10, 10],
    ]);
  });

  it('emits the closing segment for closePath', () => {
    const opList: RawOpList = {
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [
        constructPath([OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.closePath], [0, 0, 10, 0, 10, 10]),
        null,
      ],
    };
    expect(walkOperatorList(opList, VB)).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 0],
    ]);
  });

  it('bakes the CTM at build time, surviving a later save/restore', () => {
    // First line built under +100 translate; second under +150 (inside save),
    // then restore, then stroke. A correct walker keeps each segment in the CTM
    // that was live when it was built.
    const opList: RawOpList = {
      fnArray: [
        OPS.transform, // +100 in x
        OPS.constructPath, // line A under +100
        OPS.save,
        OPS.transform, // +50 more -> +150
        OPS.constructPath, // line B under +150
        OPS.restore,
        OPS.stroke,
      ],
      argsArray: [
        [1, 0, 0, 1, 100, 0],
        constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 10, 0]),
        null,
        [1, 0, 0, 1, 50, 0],
        constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 10, 0]),
        null,
        null,
      ],
    };
    expect(walkOperatorList(opList, VB)).toEqual([
      [100, 0, 110, 0],
      [150, 0, 160, 0],
    ]);
  });

  it('discards pending geometry on endPath/clip', () => {
    const opList: RawOpList = {
      fnArray: [OPS.constructPath, OPS.endPath, OPS.constructPath, OPS.stroke],
      argsArray: [
        constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 5, 0]),
        null,
        constructPath([OPS.moveTo, OPS.lineTo], [0, 0, 7, 0]),
        null,
      ],
    };
    expect(walkOperatorList(opList, VB)).toEqual([[0, 0, 7, 0]]);
  });

  it('flattens a cubic curve into CURVE_STEPS segments with correct endpoints', () => {
    const opList: RawOpList = {
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [
        // moveTo (0,0); curveTo c1(3,3) c2(7,3) end(10,0)
        constructPath([OPS.moveTo, OPS.curveTo], [0, 0, 3, 3, 7, 3, 10, 0]),
        null,
      ],
    };
    const lines = walkOperatorList(opList, VB);
    expect(lines).toHaveLength(16);
    expect(lines[0]![0]).toBeCloseTo(0, 5);
    expect(lines[0]![1]).toBeCloseTo(0, 5);
    expect(lines[15]![2]).toBeCloseTo(10, 5);
    expect(lines[15]![3]).toBeCloseTo(0, 5);
  });

  it('shifts coordinates by the viewBox origin', () => {
    const opList: RawOpList = {
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [constructPath([OPS.moveTo, OPS.lineTo], [100, 100, 200, 100]), null],
    };
    // viewBox origin (50,40) is subtracted.
    expect(walkOperatorList(opList, [50, 40, 1050, 1040])).toEqual([[50, 60, 150, 60]]);
  });
});

describe('extractTextItems', () => {
  const VB: ViewBox = [0, 0, 300, 300];

  it('extracts string, baseline position and font size', () => {
    const content: TextContentLike = {
      items: [{ str: 'PLAN', transform: [12, 0, 0, 12, 100, 200] }],
    };
    expect(extractTextItems(content, VB)).toEqual([{ s: 'PLAN', p: [100, 200], z: 12 }]);
  });

  it('records rotation when the transform is rotated', () => {
    const content: TextContentLike = {
      items: [{ str: 'N', transform: [0, 12, -12, 0, 100, 200] }],
    };
    const out = extractTextItems(content, VB);
    expect(out[0]!.r).toBeCloseTo(Math.PI / 2, 3);
  });

  it('subtracts the viewBox origin from text positions', () => {
    const content: TextContentLike = {
      items: [{ str: 'X', transform: [10, 0, 0, 10, 120, 90] }],
    };
    expect(extractTextItems(content, [20, 30, 320, 330])[0]!.p).toEqual([100, 60]);
  });

  it('skips whitespace-only and non-string items', () => {
    const content: TextContentLike = {
      items: [
        { str: '   ', transform: [10, 0, 0, 10, 0, 0] },
        { transform: [10, 0, 0, 10, 0, 0] },
        { str: 'OK', transform: [10, 0, 0, 10, 5, 5] },
      ],
    };
    expect(extractTextItems(content, VB)).toEqual([{ s: 'OK', p: [5, 5], z: 10 }]);
  });
});

describe('buildPageGeometry (pdf-lib integration)', () => {
  it('round-trips a drawn line and text through a real PDF', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    page.drawLine({
      start: { x: 50, y: 100 },
      end: { x: 200, y: 100 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    const font = await pdf.embedFont('Helvetica');
    page.drawText('Hi', { x: 50, y: 300, size: 10, font });
    const bytes = await pdf.save();

    const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    try {
      const proxy = await doc.getPage(1);
      const geom = await buildPageGeometry(proxy, 0);

      expect(geom.i).toBe(0);
      expect(geom.w).toBeCloseTo(400, 1);
      expect(geom.h).toBeCloseTo(400, 1);

      // The horizontal line should appear (pdf-lib may stroke it as a thin rect,
      // so match any near-horizontal segment spanning ~x:50..200 at y~100).
      const horizontal = geom.l.find(
        (l) =>
          Math.abs(l[1] - 100) < 1 &&
          Math.abs(l[3] - 100) < 1 &&
          Math.min(l[0], l[2]) < 60 &&
          Math.max(l[0], l[2]) > 190,
      );
      expect(horizontal).toBeDefined();

      const hi = geom.t.find((t) => t.s.includes('Hi'));
      expect(hi).toBeDefined();
      expect(hi!.p[0]).toBeCloseTo(50, 0);
      expect(hi!.p[1]).toBeCloseTo(300, 0);
      expect(hi!.z).toBeCloseTo(10, 0);

      proxy.cleanup();
    } finally {
      await doc.destroy();
    }
  });
});
