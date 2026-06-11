import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeOutline } from './outline-codec';

const MAGIC = 'BIMOUTL2';

interface TestModel {
  templates: number[][]; // each a flat list of 6*k local segment floats
  instances: { localId: number; templateIndex: number; transform: number[] }[];
}

const ident = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x: number, y: number, z: number): number[] => [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1, // column-major
];
const seg = (n: number): number[] => [n, n + 1, n + 2, n + 3, n + 4, n + 5];

/**
 * Encode format v2 per the shared contract (little-endian throughout).
 * `overrides` lets tests write inconsistent headers/lengths.
 */
function buildRaw(
  model: TestModel,
  overrides: { magic?: string; templateFloatsTotal?: number; templateLengths?: number[] } = {},
): Uint8Array {
  const templateCount = model.templates.length;
  const instanceCount = model.instances.length;
  const floatCount = model.templates.reduce((s, t) => s + t.length, 0);
  const templateFloatsTotal = overrides.templateFloatsTotal ?? floatCount;
  const magic = overrides.magic ?? MAGIC;

  const byteLength =
    20 + templateCount * 4 + floatCount * 4 + instanceCount * 4 + instanceCount * 4 + instanceCount * 64;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  for (let i = 0; i < magic.length; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(8, templateCount, true);
  view.setUint32(12, instanceCount, true);
  view.setUint32(16, templateFloatsTotal, true);

  let off = 20;
  for (let i = 0; i < templateCount; i++) {
    view.setUint32(off, overrides.templateLengths?.[i] ?? model.templates[i]!.length, true);
    off += 4;
  }
  for (const t of model.templates) for (const f of t) { view.setFloat32(off, f, true); off += 4; }
  for (const inst of model.instances) { view.setUint32(off, inst.localId, true); off += 4; }
  for (const inst of model.instances) { view.setUint32(off, inst.templateIndex, true); off += 4; }
  for (const inst of model.instances) for (const f of inst.transform) { view.setFloat32(off, f, true); off += 4; }
  return new Uint8Array(buffer);
}

const gz = (raw: Uint8Array): Uint8Array => new Uint8Array(gzipSync(raw));

describe('decodeOutline (v2)', () => {
  it('round-trips a valid instanced artifact', async () => {
    const model: TestModel = {
      templates: [seg(0.5), [...seg(100), ...seg(-3.75)]],
      instances: [
        { localId: 7, templateIndex: 0, transform: ident() },
        { localId: 42, templateIndex: 1, transform: translate(10, 20, 30) },
      ],
    };
    const decoded = await decodeOutline(gz(buildRaw(model)));

    expect(decoded).not.toBeNull();
    expect(decoded!.templates).toHaveLength(2);
    expect(decoded!.templates[0]).toEqual(new Float32Array(seg(0.5)));
    expect(decoded!.templates[1]).toEqual(new Float32Array([...seg(100), ...seg(-3.75)]));
    expect(decoded!.instanceLocalIds).toEqual(new Uint32Array([7, 42]));
    expect(decoded!.instanceTemplateIndex).toEqual(new Uint32Array([0, 1]));
    expect(decoded!.instanceTransforms).toHaveLength(32);
    // Translation lives in the last column of the second instance.
    expect(decoded!.instanceTransforms[16 + 12]).toBeCloseTo(10, 5);
    expect(decoded!.instanceTransforms[16 + 14]).toBeCloseTo(30, 5);
  });

  it('decodes an empty artifact (zero templates, zero instances)', async () => {
    const decoded = await decodeOutline(gz(buildRaw({ templates: [], instances: [] })));
    expect(decoded).not.toBeNull();
    expect(decoded!.templates).toHaveLength(0);
    expect(decoded!.instanceLocalIds).toHaveLength(0);
    expect(decoded!.instanceTransforms).toHaveLength(0);
  });

  it('returns null on bad magic', async () => {
    const raw = buildRaw(
      { templates: [seg(0)], instances: [{ localId: 1, templateIndex: 0, transform: ident() }] },
      { magic: 'BIMOUTL1' },
    );
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null on a truncated buffer', async () => {
    const raw = buildRaw({
      templates: [seg(0)],
      instances: [{ localId: 1, templateIndex: 0, transform: ident() }],
    });
    expect(await decodeOutline(gz(raw.subarray(0, raw.byteLength - 4)))).toBeNull();
  });

  it('returns null on trailing bytes beyond the declared size', async () => {
    const raw = buildRaw({
      templates: [seg(0)],
      instances: [{ localId: 1, templateIndex: 0, transform: ident() }],
    });
    const padded = new Uint8Array(raw.byteLength + 4);
    padded.set(raw);
    expect(await decodeOutline(gz(padded))).toBeNull();
  });

  it('returns null when sum(templateLengths) !== templateFloatsTotal', async () => {
    // Two 6-float templates (12 total), but declared lengths [6,12] sum to 18.
    // Buffer size stays consistent so only the sum check trips.
    const raw = buildRaw(
      {
        templates: [seg(0), seg(10)],
        instances: [{ localId: 1, templateIndex: 0, transform: ident() }],
      },
      { templateLengths: [6, 12] },
    );
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null when a template length is not a multiple of 6', async () => {
    const raw = buildRaw({
      templates: [[0, 1, 2, 3]],
      instances: [{ localId: 1, templateIndex: 0, transform: ident() }],
    });
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null when an instance references a missing template', async () => {
    const raw = buildRaw({
      templates: [seg(0)],
      instances: [{ localId: 1, templateIndex: 5, transform: ident() }],
    });
    expect(await decodeOutline(gz(raw))).toBeNull();
  });

  it('returns null on a corrupt gzip stream', async () => {
    const raw = buildRaw({
      templates: [seg(0)],
      instances: [{ localId: 1, templateIndex: 0, transform: ident() }],
    });
    expect(await decodeOutline(raw)).toBeNull(); // not gzipped
  });
});
