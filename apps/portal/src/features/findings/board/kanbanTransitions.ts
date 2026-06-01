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

export function needsModal(
  from: FindingStatusValue,
  to: FindingStatusValue,
): boolean {
  if (from === 'draft' && to === 'open') return true;
  if (to === 'resolved') return true;
  return false;
}
