import { describe, expect, it, vi } from 'vitest';

import {
  IFC_ENTITY_TO_CANONICAL,
  IFC_UPPERCASE_TO_PASCAL,
} from '../src/pipeline/canonical.js';

const idList = (
  ids: number[],
): { size: () => number; get: (i: number) => number } => ({
  size: () => ids.length,
  get: (i: number) => ids[i] as number,
});

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
  // countElements now asks web-ifc how many instances of each known type exist
  // (GetTypeCodeFromName → GetLineIDsWithType().size()) instead of walking every
  // line. The mocks model that: a per-name code map and a per-code count.
  it('counts IfcWallStandardCase entities', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');

    const WALLSTD_CODE = 3512223829;
    const mockApi = {
      GetTypeCodeFromName: vi
        .fn()
        .mockImplementation((name: string) =>
          name === 'IFCWALLSTANDARDCASE' ? WALLSTD_CODE : 0,
        ),
      GetLineIDsWithType: vi
        .fn()
        .mockImplementation((_m: number, code: number) =>
          code === WALLSTD_CODE ? idList([1, 2, 3]) : idList([]),
        ),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.elementCounts['IfcWallStandardCase']).toBe(3);
    expect(metadata.canonicalElementCounts['wall']).toBe(3);
    expect(metadata.totalElements).toBe(3);
  });

  it('builds the spatial tree from forward IfcRelAggregates', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');
    const {
      IFCPROJECT,
      IFCRELAGGREGATES,
      IFCSITE,
      IFCBUILDING,
      IFCBUILDINGSTOREY,
    } = await import('web-ifc');

    // expressID → IFC type code (Project 1 ⊃ Site 2 ⊃ Building 3 ⊃ Storey 4)
    const typeByID: Record<number, number> = {
      1: IFCPROJECT,
      2: IFCSITE,
      3: IFCBUILDING,
      4: IFCBUILDINGSTOREY,
    };
    const nameByID: Record<number, string> = {
      1: 'Test Building',
      2: 'Default Site',
      3: 'Building A',
      4: 'Ground Floor',
    };
    // IfcRelAggregates lines: id → { parent, children }
    const rels: Record<number, { parent: number; children: number[] }> = {
      100: { parent: 1, children: [2] },
      101: { parent: 2, children: [3] },
      102: { parent: 3, children: [4] },
    };

    const mockApi = {
      GetAllLines: vi.fn().mockReturnValue(idList([])),
      GetLineType: vi.fn().mockImplementation((_: number, id: number) => typeByID[id] ?? 0),
      GetNameFromTypeCode: vi.fn().mockReturnValue('IFCPROJECT'),
      GetLineIDsWithType: vi.fn().mockImplementation((_: number, code: number) => {
        if (code === IFCPROJECT) return idList([1]);
        if (code === IFCRELAGGREGATES) return idList([100, 101, 102]);
        return idList([]);
      }),
      GetLine: vi.fn().mockImplementation((_: number, id: number) => {
        const rel = rels[id];
        if (rel) {
          return {
            RelatingObject: { expressID: rel.parent },
            RelatedObjects: rel.children.map((c) => ({ expressID: c })),
          };
        }
        return { GlobalId: `guid-${String(id)}`, Name: nameByID[id] ?? null };
      }),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC4');
    const tree = metadata.spatialTree;
    expect(tree).not.toBeNull();
    expect(tree?.type).toBe('IfcProject');
    expect(tree?.name).toBe('Test Building');

    const site = tree?.children[0];
    expect(site?.type).toBe('IfcSite');
    const building = site?.children[0];
    expect(building?.type).toBe('IfcBuilding');
    const storey = building?.children[0];
    expect(storey?.type).toBe('IfcBuildingStorey');
    expect(storey?.name).toBe('Ground Floor');
    expect(storey?.children).toEqual([]);
  });

  it('builds zones from IfcRelAssignsToGroup without flattening', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');
    const { IFCRELASSIGNSTOGROUP, IFCZONE, IFCSPACE } = await import('web-ifc');

    // expressID → IFC type code. Zone 10 ⊃ spaces 11, 12 (member 13 is not a
    // space and must be ignored). Group 20 is a non-zone group whose member 14
    // must never be fetched — the IFCZONE gate short-circuits before any
    // further GetLine.
    const typeByID: Record<number, number> = {
      10: IFCZONE,
      11: IFCSPACE,
      12: IFCSPACE,
      13: 0,
      14: IFCSPACE,
      20: 0,
    };
    const nameByID: Record<number, string> = {
      10: 'Office 01',
      11: 'CHIMIE',
      12: 'LABORATOIRE',
    };
    // IfcRelAssignsToGroup lines: split the zone across two rels to exercise merging.
    const rels: Record<number, { group: number; members: number[] }> = {
      100: { group: 10, members: [11, 13] },
      101: { group: 10, members: [12] },
      102: { group: 20, members: [14] },
    };

    // `flatten: false` line shape — references come back as bare handles
    // ({ type: 5, value: expressID }), never recursively expanded objects.
    const getLine = vi.fn().mockImplementation((_: number, id: number) => {
      const rel = rels[id];
      if (rel) {
        return {
          RelatingGroup: { type: 5, value: rel.group },
          RelatedObjects: rel.members.map((m) => ({ type: 5, value: m })),
        };
      }
      return { GlobalId: `guid-${String(id)}`, Name: nameByID[id] ?? null };
    });
    const mockApi = {
      GetAllLines: vi.fn().mockReturnValue(idList([])),
      GetLineType: vi.fn().mockImplementation((_: number, id: number) => typeByID[id] ?? 0),
      GetNameFromTypeCode: vi.fn().mockReturnValue('IFCSPACE'),
      GetLineIDsWithType: vi.fn().mockImplementation((_: number, code: number) => {
        if (code === IFCRELASSIGNSTOGROUP) return idList([100, 101, 102]);
        return idList([]);
      }),
      GetLine: getLine,
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC4');
    expect(metadata.zones).toHaveLength(1);
    const zone = metadata.zones[0];
    expect(zone?.expressID).toBe(10);
    expect(zone?.name).toBe('Office 01');
    expect(zone?.spaces.map((s) => s.expressID)).toEqual([11, 12]);
    expect(zone?.spaces.map((s) => s.name)).toEqual(['CHIMIE', 'LABORATOIRE']);

    // Every GetLine in the zone walk is a scalar `flatten: false` fetch —
    // flattening a rel here recursively expanded every member's geometry tree
    // (the 4.7M-GetLine-call regression on large models).
    for (const call of getLine.mock.calls) {
      expect(call[2]).toBe(false);
    }
    // Exactly rels 100-102 + zone 10 + spaces 11, 12. The non-zone group (20)
    // short-circuits without any further GetLine, so neither it nor its member
    // (14) nor the non-space member (13) is ever fetched.
    expect(getLine.mock.calls).toHaveLength(6);
    const fetchedIds = [...new Set(getLine.mock.calls.map((call) => call[1] as number))];
    expect(fetchedIds.sort((a, b) => a - b)).toEqual([10, 11, 12, 100, 101, 102]);
  });

  it('returns no zones when the model has none', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');
    const mockApi = {
      GetAllLines: vi.fn().mockReturnValue({ size: () => 0, get: () => 0 }),
      GetLineType: vi.fn().mockReturnValue(0),
      GetNameFromTypeCode: vi.fn().mockReturnValue(undefined),
      GetLineIDsWithType: vi.fn().mockReturnValue({ size: () => 0, get: () => 0 }),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.zones).toEqual([]);
  });

  it('counts mixed IfcWall and IfcWallStandardCase', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');

    const codeByName: Record<string, number> = {
      IFCWALL: 1001,
      IFCWALLSTANDARDCASE: 1002,
    };
    const countByCode: Record<number, number> = { 1001: 2, 1002: 2 };
    const mockApi = {
      GetTypeCodeFromName: vi
        .fn()
        .mockImplementation((name: string) => codeByName[name] ?? 0),
      GetLineIDsWithType: vi
        .fn()
        .mockImplementation((_m: number, code: number) =>
          idList(Array.from({ length: countByCode[code] ?? 0 }, (_v, i) => i + 1)),
        ),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.elementCounts['IfcWall']).toBe(2);
    expect(metadata.elementCounts['IfcWallStandardCase']).toBe(2);
    expect(metadata.canonicalElementCounts['wall']).toBe(4);
    expect(metadata.totalElements).toBe(4);
  });

  it('fast path: counts only present, canonical-mapped types via GetAllTypesOfModel', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');

    const getLineIds = vi.fn().mockImplementation((_m: number, code: number) => {
      if (code === 1001) return idList([1, 2]); // IfcWall
      if (code === 1002) return idList([10, 11, 12]); // IfcWallStandardCase
      return idList([]);
    });
    const getTypeCode = vi.fn(); // must NOT be consulted on the fast path
    const mockApi = {
      GetAllTypesOfModel: vi.fn().mockReturnValue([
        { typeID: 1001, typeName: 'IFCWALL' },
        { typeID: 1002, typeName: 'IFCWALLSTANDARDCASE' },
        { typeID: 9999, typeName: 'IFCPROPERTYSINGLEVALUE' }, // not in the map
      ]),
      GetTypeCodeFromName: getTypeCode,
      GetLineIDsWithType: getLineIds,
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC4');
    expect(metadata.elementCounts['IfcWall']).toBe(2);
    expect(metadata.elementCounts['IfcWallStandardCase']).toBe(3);
    expect(metadata.canonicalElementCounts['wall']).toBe(5);
    expect(metadata.totalElements).toBe(5);

    // The unmapped type is never probed — the whole point of the fast path.
    const probedCodes = getLineIds.mock.calls.map((c) => c[1] as number);
    expect(probedCodes).toContain(1001);
    expect(probedCodes).toContain(1002);
    expect(probedCodes).not.toContain(9999);
    // Fast path short-circuits the per-name fallback loop.
    expect(getTypeCode).not.toHaveBeenCalled();
  });

  it('dedupes a space that recurs across split IfcRelAssignsToGroup lines', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');
    const { IFCRELASSIGNSTOGROUP, IFCZONE, IFCSPACE } = await import('web-ifc');

    const typeByID: Record<number, number> = { 10: IFCZONE, 11: IFCSPACE, 12: IFCSPACE };
    // Space 11 appears in BOTH rels for zone 10 — must collapse to one entry.
    const rels: Record<number, { group: number; members: number[] }> = {
      100: { group: 10, members: [11, 12] },
      101: { group: 10, members: [11] },
    };
    const mockApi = {
      GetLineType: vi.fn().mockImplementation((_: number, id: number) => typeByID[id] ?? 0),
      GetLineIDsWithType: vi.fn().mockImplementation((_: number, code: number) =>
        code === IFCRELASSIGNSTOGROUP ? idList([100, 101]) : idList([]),
      ),
      GetLine: vi.fn().mockImplementation((_: number, id: number) => {
        const rel = rels[id];
        if (rel) {
          return {
            RelatingGroup: { type: 5, value: rel.group },
            RelatedObjects: rel.members.map((m) => ({ type: 5, value: m })),
          };
        }
        return { GlobalId: `guid-${String(id)}`, Name: `name-${String(id)}` };
      }),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC4');
    expect(metadata.zones).toHaveLength(1);
    expect(metadata.zones[0]?.spaces.map((s) => s.expressID)).toEqual([11, 12]);
  });

  it('falls back to empty counts when GetTypeCodeFromName is unavailable', async () => {
    const { buildMetadata } = await import('../src/pipeline/metadata.js');
    const mockApi = {
      GetLineIDsWithType: vi.fn().mockReturnValue(idList([])),
      GetLine: vi.fn().mockReturnValue({}),
      StreamAllMeshes: vi.fn(),
    } as never;

    const metadata = await buildMetadata(mockApi, 0, 'IFC2X3');
    expect(metadata.elementCounts).toEqual({});
    expect(metadata.totalElements).toBe(0);
  });
});
