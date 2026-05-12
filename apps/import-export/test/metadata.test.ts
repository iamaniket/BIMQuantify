import { describe, expect, it, vi } from 'vitest';

import {
  IFC_ENTITY_TO_CANONICAL,
  IFC_UPPERCASE_TO_PASCAL,
} from '../src/pipeline/canonical.js';

describe('IFC_UPPERCASE_TO_PASCAL', () => {
  it('maps every canonical key', () => {
    for (const key of Object.keys(IFC_ENTITY_TO_CANONICAL)) {
      expect(IFC_UPPERCASE_TO_PASCAL.get(key.toUpperCase())).toBe(key);
    }
  });

  it('maps multi-word types correctly', () => {
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCWALLSTANDARDCASE')).toBe('IfcWallStandardCase');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCFURNISHINGELEMENT')).toBe('IfcFurnishingElement');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCBUILDINGELEMENTPROXY')).toBe('IfcBuildingElementProxy');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCDUCTSEGMENT')).toBe('IfcDuctSegment');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCPIPESEGMENT')).toBe('IfcPipeSegment');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCFLOWFITTING')).toBe('IfcFlowFitting');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCFLOWTERMINAL')).toBe('IfcFlowTerminal');
  });

  it('maps previously-missed canonical types', () => {
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCSTAIRFLIGHT')).toBe('IfcStairFlight');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCRAMPFLIGHT')).toBe('IfcRampFlight');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCCURTAINWALL')).toBe('IfcCurtainWall');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCTRANSPORTELEMENT')).toBe('IfcTransportElement');
  });

  it('maps single-word types correctly', () => {
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCWALL')).toBe('IfcWall');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCSLAB')).toBe('IfcSlab');
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCDOOR')).toBe('IfcDoor');
  });

  it('returns undefined for non-product types', () => {
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCPROPERTYSINGLEVALUE')).toBeUndefined();
    expect(IFC_UPPERCASE_TO_PASCAL.get('IFCRELDEFINESBYPROPERTIES')).toBeUndefined();
  });
});

describe('buildMetadata countElements integration', () => {
  it('counts IfcWallStandardCase entities', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');

    const mockLines = [1, 2, 3];
    const mockApi = {
      GetAllLines: vi.fn().mockReturnValue({
        size: () => mockLines.length,
        get: (i: number) => mockLines[i],
      }),
      GetLineType: vi.fn().mockReturnValue(3512223829),
      GetNameFromTypeCode: vi.fn().mockReturnValue('IFCWALLSTANDARDCASE'),
      GetLineIDsWithType: vi.fn().mockReturnValue({
        size: () => 0,
        get: () => 0,
      }),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.elementCounts['IfcWallStandardCase']).toBe(3);
    expect(metadata.canonicalElementCounts['wall']).toBe(3);
    expect(metadata.totalElements).toBe(3);
  });

  it('counts mixed IfcWall and IfcWallStandardCase', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');

    const typeNames = ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLSTANDARDCASE', 'IFCWALL'];
    const mockApi = {
      GetAllLines: vi.fn().mockReturnValue({
        size: () => typeNames.length,
        get: (i: number) => i,
      }),
      GetLineType: vi.fn().mockImplementation((_, id: number) => id),
      GetNameFromTypeCode: vi.fn().mockImplementation((code: number) => typeNames[code]),
      GetLineIDsWithType: vi.fn().mockReturnValue({
        size: () => 0,
        get: () => 0,
      }),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.elementCounts['IfcWall']).toBe(2);
    expect(metadata.elementCounts['IfcWallStandardCase']).toBe(2);
    expect(metadata.canonicalElementCounts['wall']).toBe(4);
    expect(metadata.totalElements).toBe(4);
  });
});
