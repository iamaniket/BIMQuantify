import type { BadgeVariant } from '@bimdossier/ui';

import type { FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';

export function severityBadgeVariant(severity: FindingSeverityValue): BadgeVariant {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'default';
    default:
      return 'default';
  }
}

export function statusBadgeVariant(status: FindingStatusValue): BadgeVariant {
  switch (status) {
    case 'draft':
      return 'default';
    case 'open':
      return 'info';
    case 'in_progress':
      return 'primary';
    case 'resolved':
    case 'verified':
      return 'success';
    default:
      return 'default';
  }
}
