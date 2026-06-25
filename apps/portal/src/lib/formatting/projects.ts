import type {
  Project,
  ProjectLifecycleStateValue,
  ProjectPhaseValue,
} from '@/lib/api/schemas';
import type { Locale } from '@bimdossier/i18n';
import { formatDate } from '@/lib/formatting/dates';

// Tailwind classes for the colored dot + badge per phase.
const PHASE_BADGE_CLASSES: Record<ProjectPhaseValue, string> = {
  design: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/35 dark:bg-sky-400/20 dark:text-sky-200',
  tender: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/20 dark:text-amber-200',
  work_prep: 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-400/35 dark:bg-violet-400/20 dark:text-violet-200',
  shell: 'border-green-300 bg-green-100 text-green-800 dark:border-green-400/35 dark:bg-green-400/20 dark:text-green-300',
  finishing: 'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-400/35 dark:bg-teal-400/20 dark:text-teal-200',
  handover: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-400/35 dark:bg-blue-400/20 dark:text-blue-200',
};

// Light-background dot color for project cards.
const PHASE_DOT_CLASSES: Record<ProjectPhaseValue, string> = {
  design: 'bg-sky-500',
  tender: 'bg-amber-500',
  work_prep: 'bg-violet-500',
  shell: 'bg-green-500',
  finishing: 'bg-teal-500',
  handover: 'bg-blue-500',
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

export function projectBadgeClasses(project: Pick<Project, 'phase' | 'lifecycle_state'>): string {
  if (project.lifecycle_state === 'active') {
    return PHASE_BADGE_CLASSES[project.phase];
  }
  return LIFECYCLE_BADGE_CLASSES[project.lifecycle_state];
}

export function projectDotClasses(project: Pick<Project, 'phase' | 'lifecycle_state'>): string {
  if (project.lifecycle_state === 'active') {
    return PHASE_DOT_CLASSES[project.phase];
  }
  return LIFECYCLE_DOT_CLASSES[project.lifecycle_state];
}

export function formatProjectBadgeLabel(
  project: Pick<Project, 'phase' | 'lifecycle_state'>,
  phaseLabel: string,
): string {
  if (project.lifecycle_state === 'active') {
    return phaseLabel;
  }
  return formatProjectLifecycleLabel(project.lifecycle_state);
}

export function phaseBadgeClasses(phase: ProjectPhaseValue): string {
  return PHASE_BADGE_CLASSES[phase];
}

export function phaseDotClasses(phase: ProjectPhaseValue): string {
  return PHASE_DOT_CLASSES[phase];
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
