import { describe, expect, it } from 'vitest';

import type { SpatialNode } from '@/lib/api/viewerTypes';

import { pruneSpaceNodes } from './explorer/treeBuilders';

function sp(
  expressID: number,
  type: string,
  children: SpatialNode[] = [],
): SpatialNode {
  return { expressID, globalId: null, type, name: null, children };
}

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
