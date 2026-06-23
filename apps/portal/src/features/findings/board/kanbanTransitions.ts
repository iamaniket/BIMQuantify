import type { FindingStatusValue } from '@/lib/api/schemas';

const VALID_TRANSITIONS: Record<FindingStatusValue, readonly FindingStatusValue[]> = {
  draft: ['open'],
  open: ['in_progress', 'resolved'],
  in_progress: ['open', 'resolved'],
  resolved: ['in_progress', 'verified'],
  verified: [],
};

export function isValidTransition(
  from: FindingStatusValue,
  to: FindingStatusValue,
  isInspector: boolean,
): boolean {
  if (to === 'verified' && !isInspector) return false;
  return VALID_TRANSITIONS[from].includes(to);
}

/** The legal next statuses for `from`, or `[]` when the user can't move it. */
export function allowedMoveTargets(
  from: FindingStatusValue,
  canUpdate: boolean,
  isInspector: boolean,
): FindingStatusValue[] {
  if (!canUpdate) return [];
  return VALID_TRANSITIONS[from].filter((to) => isValidTransition(from, to, isInspector));
}

export type TransitionRejection =
  | 'noPermission'
  | 'needsInspector'
  | 'verifiedLocked'
  | 'openFirst'
  | 'resolveFirst'
  | 'generic';

/**
 * Why a `from → to` move is disallowed — an i18n key under
 * `findingsBoard.dragRejected`, or `null` when the move is in fact legal.
 */
export function transitionRejectionReason(
  from: FindingStatusValue,
  to: FindingStatusValue,
  { canUpdate, isInspector }: { canUpdate: boolean; isInspector: boolean },
): TransitionRejection | null {
  if (!canUpdate) return 'noPermission';
  if (isValidTransition(from, to, isInspector)) return null;
  if (to === 'verified' && !isInspector) return 'needsInspector';
  if (from === 'verified') return 'verifiedLocked';
  if (from === 'draft') return 'openFirst';
  if (to === 'verified') return 'resolveFirst';
  return 'generic';
}
