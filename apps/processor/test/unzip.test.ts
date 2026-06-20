import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { extractIfcFromZip, NoIfcInZipError } from '../src/pipeline/unzip.js';

const IFC_BODY = strToU8(
  "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

describe('extractIfcFromZip', () => {
  it('returns the bytes of the single .ifc entry', async () => {
    const zipped = zipSync({ 'model.ifc': IFC_BODY });
    expect(await extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('picks the .ifc entry when the archive also holds other files', async () => {
    const zipped = zipSync({
      'notes.txt': strToU8('hello'),
      'building.ifc': IFC_BODY,
    });
    expect(await extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('matches the .ifc suffix case-insensitively', async () => {
    const zipped = zipSync({ 'MODEL.IFC': IFC_BODY });
    expect(await extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('rejects with NoIfcInZipError when the archive has no .ifc entry', async () => {
    const zipped = zipSync({ 'readme.txt': strToU8('no model here') });
    await expect(extractIfcFromZip(zipped)).rejects.toThrow(NoIfcInZipError);
  });
});
