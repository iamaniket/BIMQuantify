import { describe, expect, it } from 'vitest';
import { type IDxf } from 'dxf-parser';

import { buildGeometry, buildMetadata } from '../src/pipeline/dxf-geometry.js';

/** Minimal IDxf factory — only the fields the extractor reads. */
function dxf(partial: Partial<IDxf>): IDxf {
  return {
    header: {},
    entities: [],
    blocks: {},
    tables: { viewPort: {}, lineType: {}, layer: { layers: {} } } as IDxf['tables'],
    ...partial,
  } as IDxf;
}

const pt = (x: number, y: number) => ({ x, y, z: 0 });

describe('buildGeometry', () => {
  it('emits a single Y-up page with box-relative coordinates', () => {
    const art = buildGeometry(
      dxf({
        entities: [
          { type: 'LINE', layer: '0', vertices: [pt(10, 10), pt(20, 10)] },
        ] as never,
      }),
    );
    expect(art.v).toBe(1);
    expect(art.p).toHaveLength(1);
    const page = art.p[0]!;
    // bbox is (10,10)-(20,10); origin subtracted → (0,0)-(10,0).
    expect(page.l).toEqual([[0, 0, 10, 0]]);
    expect(page.w).toBe(10);
    expect(page.h).toBe(0);
  });

  it('uses header $EXTMIN/$EXTMAX for the page box and origin', () => {
    const art = buildGeometry(
      dxf({
        header: { $EXTMIN: pt(0, 0), $EXTMAX: pt(100, 50) },
        entities: [{ type: 'LINE', layer: '0', vertices: [pt(10, 20), pt(40, 20)] }] as never,
      }),
    );
    const page = art.p[0]!;
    expect(page.w).toBe(100);
    expect(page.h).toBe(50);
    expect(page.l).toEqual([[10, 20, 40, 20]]);
  });

  it('flattens a closed LWPOLYLINE into four segments', () => {
    const art = buildGeometry(
      dxf({
        header: { $EXTMIN: pt(0, 0), $EXTMAX: pt(10, 10) },
        entities: [
          {
            type: 'LWPOLYLINE',
            layer: '0',
            shape: true,
            vertices: [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)],
          },
        ] as never,
      }),
    );
    expect(art.p[0]!.l).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 10],
      [0, 10, 0, 0],
    ]);
  });

  it('tessellates a CIRCLE into SEGMENTS_PER_CIRCLE segments on the radius', () => {
    const art = buildGeometry(
      dxf({
        header: { $EXTMIN: pt(-5, -5), $EXTMAX: pt(5, 5) },
        entities: [{ type: 'CIRCLE', layer: '0', center: pt(0, 0), radius: 5 }] as never,
      }),
    );
    const lines = art.p[0]!.l;
    expect(lines).toHaveLength(64);
    // Every endpoint lies on the radius-5 circle (origin shifted to (5,5)).
    for (const [sx, sy] of lines) {
      expect(Math.hypot(sx - 5, sy - 5)).toBeCloseTo(5, 1);
    }
  });

  it('tessellates a positive bulge as a semicircle (CCW, dips to -y)', () => {
    const art = buildGeometry(
      dxf({
        header: { $EXTMIN: pt(0, -5), $EXTMAX: pt(10, 5) },
        entities: [
          {
            type: 'LWPOLYLINE',
            layer: '0',
            shape: false,
            vertices: [{ ...pt(0, 0), bulge: 1 }, pt(10, 0)],
          },
        ] as never,
      }),
    );
    const lines = art.p[0]!.l;
    // All points on the radius-5 circle centered at (5, 5) in shifted space
    // (drawing center (5,0), origin shift y0=-5 → +5).
    for (const [sx, sy] of lines) {
      expect(Math.hypot(sx - 5, sy - 5)).toBeCloseTo(5, 1);
    }
    // The arc dips below the chord (negative y in drawing space → < 5 shifted).
    const minY = Math.min(...lines.map((l) => Math.min(l[1], l[3])));
    expect(minY).toBeLessThan(1);
  });

  it('records per-line and per-text layer indices', () => {
    const art = buildGeometry(
      dxf({
        header: { $EXTMIN: pt(0, 0), $EXTMAX: pt(10, 10) },
        entities: [
          { type: 'LINE', layer: 'WALLS', vertices: [pt(0, 0), pt(5, 0)] },
          { type: 'LINE', layer: 'DOORS', vertices: [pt(5, 0), pt(5, 5)] },
          { type: 'TEXT', layer: 'WALLS', startPoint: pt(1, 1), text: 'A', textHeight: 2 },
        ] as never,
      }),
    );
    const page = art.p[0]!;
    expect(page.lyr).toEqual(['WALLS', 'DOORS']);
    expect(page.ll).toEqual([0, 1]);
    expect(page.tl).toEqual([0]);
    expect(page.t).toEqual([{ s: 'A', p: [1, 1], z: 2 }]);
  });

  it('omits layer arrays when there is no geometry', () => {
    const page = buildGeometry(dxf({})).p[0]!;
    expect(page.lyr).toBeUndefined();
    expect(page.ll).toBeUndefined();
  });
});

describe('buildMetadata', () => {
  it('reads units, version, extents, layers and entity counts', () => {
    const meta = buildMetadata(
      dxf({
        header: {
          $ACADVER: 'AC1027' as never,
          $INSUNITS: 4,
          $EXTMIN: pt(0, 0),
          $EXTMAX: pt(100, 50),
          $LASTSAVEDBY: 'alice' as never,
        },
        entities: [
          { type: 'LINE', layer: 'WALLS', vertices: [pt(0, 0), pt(1, 0)] },
          { type: 'LINE', layer: 'WALLS', vertices: [pt(1, 0), pt(1, 1)] },
          { type: 'CIRCLE', layer: 'DOORS', center: pt(0, 0), radius: 1 },
        ] as never,
        tables: {
          viewPort: {},
          lineType: {},
          layer: {
            layers: {
              WALLS: { name: 'WALLS', visible: true, colorIndex: 7, color: 0xffffff, frozen: false },
              DOORS: { name: 'DOORS', visible: false, colorIndex: 1, color: 0xff0000, frozen: true },
            },
          },
        } as IDxf['tables'],
      }),
      'dwg',
    );

    expect(meta.source).toBe('dwg');
    expect(meta.cadVersion).toBe('AC1027');
    expect(meta.units).toBe('millimeters');
    expect(meta.unitsCode).toBe(4);
    expect(meta.savedBy).toBe('alice');
    expect(meta.extents).toEqual({ min: [0, 0], max: [100, 50] });
    expect(meta.entityCounts).toEqual({ LINE: 2, CIRCLE: 1 });

    const walls = meta.layers.find((l) => l.name === 'WALLS')!;
    expect(walls.count).toBe(2);
    expect(walls.off).toBe(false);
    const doors = meta.layers.find((l) => l.name === 'DOORS')!;
    expect(doors.frozen).toBe(true);
    expect(doors.off).toBe(true);
    expect(doors.count).toBe(1);
  });

  it('defaults units to unitless when $INSUNITS is absent', () => {
    const meta = buildMetadata(dxf({}), 'dxf');
    expect(meta.units).toBe('unitless');
    expect(meta.unitsCode).toBeNull();
    expect(meta.extents).toBeNull();
    expect(meta.layers).toEqual([]);
  });
});
