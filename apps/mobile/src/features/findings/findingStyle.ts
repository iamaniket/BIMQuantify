import { colors } from '@/theme';

// Shared status/severity colours so the list, detail, and badges stay in sync.
// Mirrors the portal's finding marker tones (status drives the pill colour).

export function severityColor(severity: string): string {
  switch (severity) {
    case 'high':
      return colors.error;
    case 'medium':
      return colors.warning;
    default:
      return colors.info;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'open':
      return colors.error;
    case 'in_progress':
      return colors.warning;
    case 'resolved':
    case 'verified':
      return colors.success;
    default:
      return colors.textMuted;
  }
}
