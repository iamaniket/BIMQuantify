import type {
  Project,
  ProjectLifecycleStateValue,
  ProjectStatusValue,
} from '@/lib/api/schemas';
import type { Locale } from '@bimstitch/i18n';
import { formatDate } from '@/lib/formatting/dates';

// Tailwind classes for the colored dot + badge per status.
const STATUS_BADGE_CLASSES: Record<ProjectStatusValue, string> = {
  planning: 'border-border bg-background-tertiary text-foreground-secondary',
  design: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/35 dark:bg-sky-400/20 dark:text-sky-200',
  permit_review: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/20 dark:text-amber-200',
  construction: 'border-green-300 bg-green-100 text-green-800 dark:border-green-400/35 dark:bg-green-400/20 dark:text-green-300',
  handover: 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-400/35 dark:bg-violet-400/20 dark:text-violet-200',
  complete: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-400/35 dark:bg-blue-400/20 dark:text-blue-200',
  on_hold: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-400/35 dark:bg-rose-400/20 dark:text-rose-300',
};

// Light-background dot color for project cards.
const STATUS_DOT_CLASSES: Record<ProjectStatusValue, string> = {
  planning: 'bg-foreground-tertiary',
  design: 'bg-sky-500',
  permit_review: 'bg-amber-500',
  construction: 'bg-green-500',
  handover: 'bg-violet-500',
  complete: 'bg-blue-500',
  on_hold: 'bg-rose-500',
};

const LIFECYCLE_BADGE_CLASSES: Record<ProjectLifecycleStateValue, string> = {
  active: 'border-border bg-background-tertiary text-foreground-secondary',
  archived: 'border-border bg-background-tertiary text-foreground-secondary',
  removed: 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-400/35 dark:bg-rose-400/20 dark:text-rose-200',
};

const LIFECYCLE_DOT_CLASSES: Record<ProjectLifecycleStateValue, string> = {
  active: 'bg-foreground-tertiary',
  archived: 'bg-foreground-tertiary',
  removed: 'bg-rose-500',
};


export function formatProjectLifecycleLabel(lifecycleState: ProjectLifecycleStateValue): string {
  switch (lifecycleState) {
    case 'archived':
      return 'Archived';
    case 'removed':
      return 'Removed';
    case 'active':
    default:
      return 'Active';
  }
}

export function isProjectArchived(project: Pick<Project, 'lifecycle_state'>): boolean {
  return project.lifecycle_state === 'archived';
}

export function projectBadgeClasses(project: Pick<Project, 'status' | 'lifecycle_state'>): string {
  if (project.lifecycle_state === 'active') {
    return STATUS_BADGE_CLASSES[project.status];
  }
  return LIFECYCLE_BADGE_CLASSES[project.lifecycle_state];
}

export function projectDotClasses(project: Pick<Project, 'status' | 'lifecycle_state'>): string {
  if (project.lifecycle_state === 'active') {
    return STATUS_DOT_CLASSES[project.status];
  }
  return LIFECYCLE_DOT_CLASSES[project.lifecycle_state];
}

export function formatProjectBadgeLabel(
  project: Pick<Project, 'status' | 'lifecycle_state'>,
  statusLabel: string,
): string {
  if (project.lifecycle_state === 'active') {
    return statusLabel;
  }
  return formatProjectLifecycleLabel(project.lifecycle_state);
}

export function statusBadgeClasses(status: ProjectStatusValue): string {
  return STATUS_BADGE_CLASSES[status];
}

export function statusDotClasses(status: ProjectStatusValue): string {
  return STATUS_DOT_CLASSES[status];
}

export function formatAddress(parts: {
  street: string | null;
  house_number: string | null;
  postal_code: string | null;
  city: string | null;
}): string | null {
  const lineOne = [parts.street, parts.house_number].filter(Boolean).join(' ').trim();
  const lineTwo = [parts.postal_code, parts.city].filter(Boolean).join(' ').trim();
  const combined = [lineOne, lineTwo].filter((s) => s.length > 0).join(', ');
  return combined.length === 0 ? null : combined;
}

/** Days between today and the delivery date (negative if overdue). */
export function daysUntil(isoDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function formatDeliveryDate(isoDate: string, locale: Locale): string {
  return formatDate(isoDate, locale, isoDate);
}
