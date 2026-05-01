import type {
  Project,
  ProjectLifecycleStateValue,
  ProjectPhaseValue,
  ProjectStatusValue,
} from '@/lib/api/schemas';
import type { Locale, PortalMessages } from '@bimstitch/i18n';

// Tailwind classes for the colored dot + badge per status.
const STATUS_BADGE_CLASSES: Record<ProjectStatusValue, string> = {
  planning: 'border-slate-400/35 bg-slate-400/20 text-slate-200',
  ontwerp: 'border-sky-400/35 bg-sky-400/20 text-sky-200',
  vergunning: 'border-amber-400/35 bg-amber-400/20 text-amber-200',
  uitvoering: 'border-green-400/35 bg-green-400/20 text-green-300',
  oplevering: 'border-violet-400/35 bg-violet-400/20 text-violet-200',
  gereed: 'border-blue-400/35 bg-blue-400/20 text-blue-200',
  on_hold: 'border-rose-400/35 bg-rose-400/20 text-rose-300',
};

// Light-background dot color for project cards.
const STATUS_DOT_CLASSES: Record<ProjectStatusValue, string> = {
  planning: 'bg-slate-400',
  ontwerp: 'bg-sky-500',
  vergunning: 'bg-amber-500',
  uitvoering: 'bg-green-500',
  oplevering: 'bg-violet-500',
  gereed: 'bg-blue-500',
  on_hold: 'bg-rose-500',
};

const LIFECYCLE_BADGE_CLASSES: Record<ProjectLifecycleStateValue, string> = {
  active: 'border-slate-400/35 bg-slate-400/20 text-slate-200',
  archived: 'border-white/30 bg-white/16 text-white',
  removed: 'border-rose-400/35 bg-rose-400/20 text-rose-200',
};

const LIFECYCLE_DOT_CLASSES: Record<ProjectLifecycleStateValue, string> = {
  active: 'bg-slate-400',
  archived: 'bg-white',
  removed: 'bg-rose-500',
};

export function formatStatus(status: ProjectStatusValue): string {
  return status;
}

export function formatStatusLabel(
  status: ProjectStatusValue,
  messages: PortalMessages,
): string {
  return messages.projects.statuses[status];
}

export function formatPhase(phase: ProjectPhaseValue): string {
  return phase;
}

export function formatPhaseLabel(
  phase: ProjectPhaseValue,
  messages: PortalMessages,
): string {
  return messages.projects.phases[phase];
}

export function formatStatusAndPhaseLabel(
  status: ProjectStatusValue,
  phase: ProjectPhaseValue,
  messages: PortalMessages,
): string {
  return `${messages.projects.statuses[status]} · ${messages.projects.phases[phase]}`;
}

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
  messages: PortalMessages,
): string {
  if (project.lifecycle_state === 'active') {
    return formatStatusLabel(project.status, messages);
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
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}
