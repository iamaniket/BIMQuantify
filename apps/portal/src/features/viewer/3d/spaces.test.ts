import { describe, expect, it } from 'vitest';

import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

import { pruneSpaceNodes } from './explorer/treeBuilders';
import { collectSpaceLocalIds } from './spaces';

function sp(
  expressID: number,
  type: string,
  children: SpatialNode[] = [],
): SpatialNode {
  return { expressID, globalId: null, type, name: null, children };
}

describe('collectSpaceLocalIds', () => {
  it('returns [] when metadata is undefined', () => {
    expect(collectSpaceLocalIds(undefined)).toEqual([]);
  });

  it('unions IfcSpace ids from elements, spatial tree, and zones (deduped)', () => {
    const metadata = {
      spatialTree: sp(1, 'IfcProject', [
        sp(2, 'IfcBuildingStorey', [sp(10, 'IfcSpace'), sp(11, 'IfcSpace')]),
      ]),
      zones: [
        { expressID: 50, globalId: null, name: 'Z', spaces: [
          { expressID: 11, name: null }, // dup of tree
          { expressID: 12, name: null }, // zones-only space
        ] },
      ],
      elements: [
        { expressID: 10, globalId: null, type: 'IfcSpace', name: null, containedIn: 2 }, // dup of tree
        { expressID: 20, globalId: null, type: 'IfcWall', name: null, containedIn: 2 },
        { expressID: 21, globalId: null, type: 'IfcSpace', name: null, containedIn: 2 },
      ],
    } as unknown as ModelMetadata;

    expect(collectSpaceLocalIds(metadata).sort((a, b) => a - b)).toEqual([10, 11, 12, 21]);
  });

  it('ignores non-space types', () => {
    const metadata = {
      spatialTree: sp(1, 'IfcProject', [sp(2, 'IfcBuildingStorey')]),
      elements: [
        { expressID: 20, globalId: null, type: 'IfcWall', name: null, containedIn: 2 },
      ],
    } as unknown as ModelMetadata;
    expect(collectSpaceLocalIds(metadata)).toEqual([]);
  });
});

describe('pruneSpaceNodes', () => {
  it('drops IfcSpace nodes and hoists their children to the parent', () => {
    const tree = sp(1, 'IfcProject', [
      sp(2, 'IfcBuildingStorey', [
        sp(10, 'IfcSpace', [sp(100, 'IfcFurnishingElement')]),
        sp(20, 'IfcWall'),
      ]),
    ]);

    const pruned = pruneSpaceNodes(tree);
    const storey = pruned.children[0]!;
    const types = storey.children.map((c) => c.type).sort();

    // The space is gone; its furnishing child is hoisted up beside the wall.
    expect(types).toEqual(['IfcFurnishingElement', 'IfcWall']);
    expect(storey.children.some((c) => c.type === 'IfcSpace')).toBe(false);
  });

  it('leaves a space-free tree unchanged in shape', () => {
    const tree = sp(1, 'IfcProject', [sp(2, 'IfcBuildingStorey', [sp(20, 'IfcWall')])]);
    const pruned = pruneSpaceNodes(tree);
    expect(pruned.children[0]!.children.map((c) => c.expressID)).toEqual([20]);
  });
});
