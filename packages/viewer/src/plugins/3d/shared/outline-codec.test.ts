import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeOutline } from './outline-codec';

const MAGIC = 'BIMOUTL1';

interface ArtifactElement {
  localId: number;
  positions: number[];
}

/**
 * Encode format v1 per the shared contract (little-endian throughout):
 * magic, uint32 elementCount, uint32 totalFloats, localIds[], lengths[],
 * positions[]. `overrides` lets tests write inconsistent headers/lengths.
 */
function buildRaw(
  elements: ArtifactElement[],
  overrides: { magic?: string; totalFloats?: number; lengths?: number[] } = {},
): Uint8Array {
  const floatCount = elements.reduce((sum, e) => sum + e.positions.length, 0);
  const totalFloats = overrides.totalFloats ?? floatCount;
  const magic = overrides.magic ?? MAGIC;
  const buffer = new ArrayBuffer(16 + elements.length * 8 + floatCount * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < magic.length; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(8, elements.length, true);
  view.setUint32(12, totalFloats, true);
  let off = 16;
  for (const e of elements) {
    view.setUint32(off, e.localId, true);
    off += 4;
  }
  for (let i = 0; i < elements.length; i++) {
    view.setUint32(off, overrides.lengths?.[i] ?? elements[i]!.positions.length, true);
    off += 4;
  }
  for (const e of elements) {
    for (const f of e.positions) {
      view.setFloat32(off, f, true);
      off += 4;
    }
  }
  return new Uint8Array(buffer);
}

const gz = (raw: Uint8Array): Uint8Array => new Uint8Array(gzipSync(raw));

const seg = (n: number): number[] => [n, n + 1, n + 2, n + 3, n + 4, n + 5];

describe('decodeOutline', () => {
  it('round-trips a valid artifact', async () => {
    const elements: ArtifactElement[] = [
      { localId: 7, positions: seg(0.5) },
      { localId: 42, positions: [...seg(100), ...seg(-3.75)] },
    ];
    const decoded = await decodeOutline(gz(buildRaw(elements)));

    expect(decoded).not.toBeNull();
    expect(decoded!.localIds).toEqual(new Uint32Array([7, 42]));
    expect(decoded!.lengths).toEqual(new Uint32Array([6, 12]));
    expect(decoded!.positions).toEqual(
      new Float32Array([...seg(0.5), ...seg(100), ...seg(-3.75)]),
    );
  });

  it('decodes an empty artifact (zero elements)', async () => {
    const decoded = await decodeOutline(gz(buildRaw([])));
    expect(decoded).not.toBeNull();
    expect(decoded!.localIds).toHaveLength(0);
    expect(decoded!.lengths).toHaveLength(0);
    expect(decoded!.positions).toHaveLength(0);
  });

  it('returns null on bad magic', async () => {
    const raw = buildRaw([{ localId: 1, positions: seg(0) }], {
      magic: 'BIMOUTL2',
    });
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null on a truncated buffer', async () => {
    const raw = buildRaw([{ localId: 1, positions: seg(0) }]);
    expect(await decodeOutline(gz(raw.subarray(0, raw.byteLength - 4)))).toBeNull();
  });

  it('returns null on trailing bytes beyond the declared size', async () => {
    const raw = buildRaw([{ localId: 1, positions: seg(0) }]);
    const padded = new Uint8Array(raw.byteLength + 4);
    padded.set(raw);
    expect(await decodeOutline(gz(padded))).toBeNull();
  });

  it('returns null when sum(lengths) !== totalFloats', async () => {
    // Declared lengths [6, 12] sum to 18 but the header/payload carry 12
    // floats — buffer size stays consistent so only the sum check trips.
    const raw = buildRaw(
      [
        { localId: 1, positions: seg(0) },
        { localId: 2, positions: seg(10) },
      ],
      { lengths: [6, 12] },
    );
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null when a length is not a multiple of 6', async () => {
    const raw = buildRaw([{ localId: 1, positions: [0, 1, 2, 3] }]);
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null on a corrupt gzip stream', async () => {
    const raw = buildRaw([{ localId: 1, positions: seg(0) }]);
    expect(await decodeOutline(raw)).toBeNull();
  });
});
