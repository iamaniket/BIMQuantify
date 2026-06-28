import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { PermanentError } from '../src/pipeline/errors.js';
import { extractIfcFromZip, NoIfcInZipError } from '../src/pipeline/unzip.js';

const IFC_BODY = strToU8(
  "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

// Generous cap for the happy-path cases; the bomb cases pass a tiny cap.
const MAX = 2 * 1024 * 1024 * 1024;

describe('extractIfcFromZip', () => {
  it('returns the bytes of the single .ifc entry', async () => {
    const zipped = zipSync({ 'model.ifc': IFC_BODY });
    expect(await extractIfcFromZip(zipped, MAX)).toEqual(IFC_BODY);
  });

  it('picks the .ifc entry when the archive also holds other files', async () => {
    const zipped = zipSync({
      'notes.txt': strToU8('hello'),
      'building.ifc': IFC_BODY,
    });
    expect(await extractIfcFromZip(zipped, MAX)).toEqual(IFC_BODY);
  });

  it('matches the .ifc suffix case-insensitively', async () => {
    const zipped = zipSync({ 'MODEL.IFC': IFC_BODY });
    expect(await extractIfcFromZip(zipped, MAX)).toEqual(IFC_BODY);
  });

  it('rejects with NoIfcInZipError when the archive has no .ifc entry', async () => {
    const zipped = zipSync({ 'readme.txt': strToU8('no model here') });
    await expect(extractIfcFromZip(zipped, MAX)).rejects.toThrow(NoIfcInZipError);
  });

  it('rejects an oversized .ifc entry pre-inflate (originalSize) with IFC_TOO_LARGE', async () => {
    // Highly-compressible payload: a small zip whose inner .ifc declares (and
    // inflates to) far more than the cap — a classic zip bomb.
    const big = new Uint8Array(64 * 1024); // all zeros → compresses to a few bytes
    const zipped = zipSync({ 'bomb.ifc': big });
    expect(zipped.length).toBeLessThan(big.length);
    await expect(extractIfcFromZip(zipped, 1024)).rejects.toMatchObject({
      name: 'PermanentError',
      kind: 'validation',
    });
    await expect(extractIfcFromZip(zipped, 1024)).rejects.toThrow(/IFC_TOO_LARGE/);
  });

  it('accepts an .ifc entry exactly at the cap', async () => {
    const zipped = zipSync({ 'model.ifc': IFC_BODY });
    expect(await extractIfcFromZip(zipped, IFC_BODY.length)).toEqual(IFC_BODY);
  });

  it('surfaces the oversize rejection as a PermanentError instance', async () => {
    const zipped = zipSync({ 'bomb.ifc': new Uint8Array(8192) });
    await expect(extractIfcFromZip(zipped, 16)).rejects.toBeInstanceOf(PermanentError);
  });
});
