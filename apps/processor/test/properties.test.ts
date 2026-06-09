import { describe, expect, it, vi } from 'vitest';

import type { ElementEntry } from '../src/pipeline/metadata.js';

/**
 * These tests lock the output shape of buildProperties after the flatten
 * optimisation. The mocked IfcAPI models the `flatten: false` contract that the
 * optimised walks rely on: relationships return their related objects as bare
 * handles (`{ value: expressID }`), and the code resolves GlobalIds via the
 * expressID→globalId map (built from `elements`) with a scalar GetLine fallback
 * for objects the map doesn't contain.
 */

const idList = (
  ids: number[],
): { size: () => number; get: (i: number) => number } => ({
  size: () => ids.length,
  get: (i: number) => ids[i] as number,
});

const elements: ElementEntry[] = [
  { expressID: 100, globalId: 'gid-door', type: 'IfcDoor', name: 'Door 1', containedIn: 1 },
  { expressID: 200, globalId: 'gid-wall', type: 'IfcWall', name: 'Wall 1', containedIn: 1 },
];

async function buildFromMock() {
  const { buildProperties } = await import('../src/pipeline/properties.js');
  const { IFCRELDEFINESBYPROPERTIES, IFCRELDEFINESBYTYPE } = await import('web-ifc');

  // expressID → line. Reference attributes are modelled as handles ({ value })
  // to mirror web-ifc's `flatten: false` return shape.
  const lines: Record<number, Record<string, unknown>> = {
    // Element instances (read by the seed loop / fallback via GetLine(id, false))
    100: { GlobalId: { value: 'gid-door' }, Name: { value: 'Door 1' } },
    200: { GlobalId: { value: 'gid-wall' }, Name: { value: 'Wall 1' } },
    999: { GlobalId: { value: 'gid-extra' } },
    // Instance property set (targeted flatten)
    301: {
      Name: { value: 'Pset_DoorCommon' },
      HasProperties: [
        { Name: { value: 'FireRating' }, NominalValue: { value: 'REI60' } },
        { Name: { value: 'Width' }, NominalValue: { value: 900 } },
      ],
    },
    // Type object (targeted flatten) with its own pset
    401: {
      Name: { value: 'StandardDoor' },
      HasPropertySets: [
        {
          Name: { value: 'Pset_DoorCommon' },
          HasProperties: [
            { Name: { value: 'IsExternal' }, NominalValue: { value: true } },
          ],
        },
      ],
    },
    // Pset attached to an object NOT present in `elements` (fallback path)
    501: {
      Name: { value: 'Pset_WallCommon' },
      HasProperties: [
        { Name: { value: 'FireRating' }, NominalValue: { value: 'REI30' } },
      ],
    },
    // Relationship lines (read with flatten: false → handles)
    300: { RelatingPropertyDefinition: { value: 301 }, RelatedObjects: [{ value: 100 }] },
    400: { RelatingType: { value: 401 }, RelatedObjects: [{ value: 100 }] },
    500: { RelatingPropertyDefinition: { value: 501 }, RelatedObjects: [{ value: 999 }] },
  };

  const mockApi = {
    GetLineIDsWithType: vi.fn().mockImplementation((_m: number, code: number) => {
      if (code === IFCRELDEFINESBYPROPERTIES) return idList([300, 500]);
      if (code === IFCRELDEFINESBYTYPE) return idList([400]);
      return idList([]);
    }),
    GetLine: vi
      .fn()
      .mockImplementation((_m: number, id: number) => lines[id] ?? {}),
    GetLineType: vi.fn().mockImplementation((_m: number, id: number) => (id === 401 ? 5 : 0)),
    GetNameFromTypeCode: vi
      .fn()
      .mockImplementation((code: number) => (code === 5 ? 'IFCDOORTYPE' : undefined)),
  } as never;

  return buildProperties(mockApi, 0, elements);
}

describe('buildProperties', () => {
  it('maps an instance property set to canonical + raw, keyed by GlobalId from the elements map', async () => {
    const props = await buildFromMock();
    const door = props['gid-door'];
    expect(door).toBeDefined();
    expect(door?._element_type).toBe('door');
    // Canonical mappings (Pset_DoorCommon::FireRating → fire_safety.fire_rating, ::Width → common.width)
    expect(door?.['fire_safety']).toMatchObject({ fire_rating: 'REI60' });
    expect(door?.['common']).toMatchObject({ width: 900 });
    // Raw pset preserved under its original name
    expect(door?.['Pset_DoorCommon']).toMatchObject({ FireRating: 'REI60', Width: 900 });
  });

  it('seeds elements that have no property sets with type + attributes', async () => {
    const props = await buildFromMock();
    const wall = props['gid-wall'];
    expect(wall).toBeDefined();
    expect(wall?._element_type).toBe('wall');
    expect(wall?.['Attributes']).toEqual({ GlobalId: 'gid-wall', Name: 'Wall 1' });
    expect(wall?.['fire_safety']).toBeUndefined();
  });

  it('applies IfcRelDefinesByType attributes and [Type] property sets', async () => {
    const props = await buildFromMock();
    const door = props['gid-door'];
    expect(door?.['Type Attributes']).toMatchObject({ Name: 'StandardDoor', IfcType: 'IFCDOORTYPE' });
    // Prefixed raw type pset
    expect(door?.['[Type] Pset_DoorCommon']).toEqual({ IsExternal: true });
    // Type pset also canonical-mapped (Pset_DoorCommon::IsExternal → common.is_external)
    expect(door?.['common']).toMatchObject({ is_external: true });
  });

  it('falls back to a scalar GetLine GlobalId for objects absent from the elements map', async () => {
    const props = await buildFromMock();
    const extra = props['gid-extra'];
    expect(extra).toBeDefined();
    expect(extra?.['fire_safety']).toEqual({ fire_rating: 'REI30' });
  });
});
