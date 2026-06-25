'use client';

import { User } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

import { UserAvatar } from '@/components/shared/UserAvatar';
import type { ProjectMember } from '@/lib/api/schemas';

/** Sentinel key for the "no assignee" chip in an assignee-filter set. */
export const UNASSIGNED_FILTER = '__unassigned__';

type Props = {
  members: ProjectMember[];
  /** Selected user ids; include {@link UNASSIGNED_FILTER} for the unassigned chip. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  className?: string;
};

/**
 * Jira-style multi-select assignee filter: a row of toggleable member avatar
 * chips plus an "Unassigned" chip. Store-agnostic (state flows in via props) so
 * the Findings Board and List tabs share one control. Renders nothing when the
 * project has no members.
 */
export function AssigneeFilterChips({
  members,
  selected,
  onToggle,
  className,
}: Props): JSX.Element | null {
  const t = useTranslations('findingsBoard.filter');

  if (members.length === 0) return null;

  const chipClass = (on: boolean): string => cn(
    'rounded-full transition-all',
    on
      ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface-main'
      : 'opacity-50 hover:opacity-100',
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {members.map((m) => {
        const name = m.full_name ?? m.email;
        const on = selected.has(m.user_id);
        return (
          <button
            key={m.user_id}
            type="button"
            aria-pressed={on}
            aria-label={t('assigneeTooltip', { name })}
            title={t('assigneeTooltip', { name })}
            onClick={() => { onToggle(m.user_id); }}
            className={chipClass(on)}
          >
            <UserAvatar name={name} email={m.email} size="sm" />
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={selected.has(UNASSIGNED_FILTER)}
        aria-label={t('unassigned')}
        title={t('unassigned')}
        onClick={() => { onToggle(UNASSIGNED_FILTER); }}
        className={cn(
          'grid h-6 w-6 place-items-center rounded-full border-[1.5px] border-dashed border-border text-foreground-placeholder',
          chipClass(selected.has(UNASSIGNED_FILTER)),
        )}
      >
        <User className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
