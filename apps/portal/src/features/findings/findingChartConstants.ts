import type { FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';

// Status colors lean on primary (open / in-progress) with success reserved for
// the "done" states and a neutral for drafts — see CLAUDE.md token rule. Shared
// by the findings overview tab and the project-completeness rings so the two
// never drift.
export const STATUS_COLORS: Record<FindingStatusValue, string> = {
  draft: 'var(--foreground-tertiary)',
  open: 'var(--primary)',
  in_progress: 'var(--primary-hover)',
  resolved: 'var(--success)',
  verified: 'var(--success-hover)',
};

// Severity colors: high = error, medium = warning, low = info. Used by the
// findings-by-severity pie in the completeness rings.
export const SEVERITY_COLORS: Record<FindingSeverityValue, string> = {
  high: 'var(--error)',
  medium: 'var(--warning)',
  low: 'var(--info)',
};

export const STATUS_ORDER: FindingStatusValue[] = [
  'draft',
  'open',
  'in_progress',
  'resolved',
  'verified',
];

export const SEVERITY_ORDER: FindingSeverityValue[] = ['high', 'medium', 'low'];
