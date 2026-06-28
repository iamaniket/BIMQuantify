import { describe, expect, it } from 'vitest';

import { unionMembershipByLevel, type MembershipModel } from './levelMembership';

describe('unionMembershipByLevel', () => {
  it('unions elements from multiple discipline models onto their shared Level', () => {
    const arch: MembershipModel = {
      viewerModelId: 'file-arch',
      membership: new Map([[100, [1, 2]]]), // storey 100 -> elements 1,2
      storeys: [{ express_id: 100, level_id: 'L1' }],
    };
    const struct: MembershipModel = {
      viewerModelId: 'file-struct',
      membership: new Map([[200, [9]]]), // storey 200 -> element 9
      storeys: [{ express_id: 200, level_id: 'L1' }], // same project Level
    };

    const out = unionMembershipByLevel([arch, struct]);
    expect(out.get('L1')).toEqual([
      { modelId: 'file-arch', localId: 1 },
      { modelId: 'file-arch', localId: 2 },
      { modelId: 'file-struct', localId: 9 },
    ]);
  });

  it('keys items by the source model so isolation hits the right model', () => {
    const a: MembershipModel = {
      viewerModelId: 'file-a',
      membership: new Map([[1, [5]]]),
      storeys: [{ express_id: 1, level_id: 'L1' }],
    };
    const b: MembershipModel = {
      viewerModelId: 'file-b',
      membership: new Map([[1, [5]]]), // same express id in a DIFFERENT model
      storeys: [{ express_id: 1, level_id: 'L2' }],
    };
    const out = unionMembershipByLevel([a, b]);
    expect(out.get('L1')).toEqual([{ modelId: 'file-a', localId: 5 }]);
    expect(out.get('L2')).toEqual([{ modelId: 'file-b', localId: 5 }]);
  });

  it('skips storeys with no reconciled Level or no elements (never blanks a model)', () => {
    const m: MembershipModel = {
      viewerModelId: 'file-m',
      membership: new Map([[1, [7]], [2, []]]),
      storeys: [
        { express_id: 1, level_id: null }, // unreconciled -> skipped
        { express_id: 2, level_id: 'L1' }, // no elements -> skipped
        { express_id: 3, level_id: 'L1' }, // not in membership -> skipped
      ],
    };
    expect(unionMembershipByLevel([m]).size).toBe(0);
  });
});
