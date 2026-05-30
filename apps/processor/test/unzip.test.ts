import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { extractIfcFromZip, NoIfcInZipError } from '../src/pipeline/unzip.js';

const IFC_BODY = strToU8(
  "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

describe('extractIfcFromZip', () => {
  it('returns the bytes of the single .ifc entry', () => {
    const zipped = zipSync({ 'model.ifc': IFC_BODY });
    expect(extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('picks the .ifc entry when the archive also holds other files', () => {
    const zipped = zipSync({
      'notes.txt': strToU8('hello'),
      'building.ifc': IFC_BODY,
    });
    expect(extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('matches the .ifc suffix case-insensitively', () => {
    const zipped = zipSync({ 'MODEL.IFC': IFC_BODY });
    expect(extractIfcFromZip(zipped)).toEqual(IFC_BODY);
  });

  it('throws NoIfcInZipError when the archive has no .ifc entry', () => {
    const zipped = zipSync({ 'readme.txt': strToU8('no model here') });
    expect(() => extractIfcFromZip(zipped)).toThrow(NoIfcInZipError);
  });
});
