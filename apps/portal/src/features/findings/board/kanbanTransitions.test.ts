import { describe, expect, it } from 'vitest';

import type { FindingStatusValue } from '@/lib/api/schemas';

import {
  allowedMoveTargets,
  isValidTransition,
  transitionRejectionReason,
} from './kanbanTransitions';

const ALL: FindingStatusValue[] = ['draft', 'open', 'in_progress', 'resolved', 'verified'];

describe('isValidTransition', () => {
  it('accepts the legal lifecycle moves', () => {
    expect(isValidTransition('draft', 'open', false)).toBe(true);
    expect(isValidTransition('open', 'in_progress', false)).toBe(true);
    expect(isValidTransition('open', 'resolved', false)).toBe(true);
    expect(isValidTransition('in_progress', 'open', false)).toBe(true);
    expect(isValidTransition('in_progress', 'resolved', false)).toBe(true);
    expect(isValidTransition('resolved', 'in_progress', false)).toBe(true);
  });

  it('only lets an inspector move into verified', () => {
    expect(isValidTransition('resolved', 'verified', false)).toBe(false);
    expect(isValidTransition('resolved', 'verified', true)).toBe(true);
  });

  it('rejects skips and moves out of the terminal state', () => {
    expect(isValidTransition('draft', 'in_progress', false)).toBe(false);
    expect(isValidTransition('draft', 'resolved', false)).toBe(false);
    expect(isValidTransition('open', 'verified', true)).toBe(false);
    for (const to of ALL) expect(isValidTransition('verified', to, true)).toBe(false);
  });
});

describe('allowedMoveTargets', () => {
  it('returns nothing without update permission', () => {
    expect(allowedMoveTargets('open', false, true)).toEqual([]);
  });

  it('returns the legal next states for an editor', () => {
    expect(allowedMoveTargets('draft', true, false)).toEqual(['open']);
    expect(allowedMoveTargets('open', true, false)).toEqual(['in_progress', 'resolved']);
    expect(allowedMoveTargets('in_progress', true, false)).toEqual(['open', 'resolved']);
  });

  it('exposes verify only to inspectors', () => {
    expect(allowedMoveTargets('resolved', true, false)).toEqual(['in_progress']);
    expect(allowedMoveTargets('resolved', true, true)).toEqual(['in_progress', 'verified']);
  });

  it('returns nothing from the terminal state', () => {
    expect(allowedMoveTargets('verified', true, true)).toEqual([]);
  });
});

describe('transitionRejectionReason', () => {
  const editor = { canUpdate: true, isInspector: false };
  const inspector = { canUpdate: true, isInspector: true };

  it('is null for a legal move', () => {
    expect(transitionRejectionReason('draft', 'open', editor)).toBeNull();
    expect(transitionRejectionReason('resolved', 'verified', inspector)).toBeNull();
  });

  it('reports a permission problem first', () => {
    expect(
      transitionRejectionReason('open', 'in_progress', { canUpdate: false, isInspector: true }),
    ).toBe('noPermission');
  });

  it('explains the inspector-only verify gate', () => {
    expect(transitionRejectionReason('resolved', 'verified', editor)).toBe('needsInspector');
  });

  it('explains the terminal lock and the draft-first rule', () => {
    expect(transitionRejectionReason('verified', 'open', inspector)).toBe('verifiedLocked');
    expect(transitionRejectionReason('draft', 'in_progress', editor)).toBe('openFirst');
  });

  it('explains that a finding must be resolved before verification', () => {
    expect(transitionRejectionReason('open', 'verified', inspector)).toBe('resolveFirst');
    expect(transitionRejectionReason('in_progress', 'verified', inspector)).toBe('resolveFirst');
  });
});
