/**
 * extractStoreys flattens IfcBuildingStorey nodes out of the spatial tree the
 * metadata walk builds. Pure over the tree — no web-ifc instance needed.
 */

import { describe, expect, it } from 'vitest';

import { extractStoreys, type SpatialNode } from '../src/pipeline/metadata.js';

function storey(expressID: number, globalId: string, name: string, elevation: number | null): SpatialNode {
  return { expressID, globalId, type: 'IfcBuildingStorey', name, elevation, children: [] };
}

describe('extractStoreys', () => {
  it('returns [] for a null tree', () => {
    expect(extractStoreys(null)).toEqual([]);
  });

  it('pulls every storey out of a Project→Site→Building→Storey tree', () => {
    const tree: SpatialNode = {
      expressID: 1,
      globalId: 'project',
      type: 'IfcProject',
      name: 'P',
      elevation: null,
      children: [
        {
          expressID: 2,
          globalId: 'site',
          type: 'IfcSite',
          name: 'S',
          elevation: null,
          children: [
            {
              expressID: 3,
              globalId: 'building',
              type: 'IfcBuilding',
              name: 'B',
              elevation: null,
              children: [
                storey(4, 'guid-L1', 'Level 1', 0),
                storey(5, 'guid-L2', 'Level 2', 3),
              ],
            },
          ],
        },
      ],
    };

    expect(extractStoreys(tree)).toEqual([
      { expressID: 4, globalId: 'guid-L1', name: 'Level 1', elevation: 0 },
      { expressID: 5, globalId: 'guid-L2', name: 'Level 2', elevation: 3 },
    ]);
  });

  it('ignores non-storey spatial nodes and preserves null elevation', () => {
    const tree: SpatialNode = {
      expressID: 1,
      globalId: 'building',
      type: 'IfcBuilding',
      name: 'B',
      elevation: null,
      children: [
        storey(2, 'guid-only', 'Roof', null),
        { expressID: 3, globalId: 'space', type: 'IfcSpace', name: 'Room', elevation: null, children: [] },
      ],
    };

    expect(extractStoreys(tree)).toEqual([
      { expressID: 2, globalId: 'guid-only', name: 'Roof', elevation: null },
    ]);
  });
});
