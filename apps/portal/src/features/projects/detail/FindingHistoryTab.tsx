'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { useFindingHistory } from '@/features/findings/useFindingHistory';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { formatDate, formatDateTime } from '@/lib/formatting/dates';
import type { Finding, FindingHistoryChange } from '@/lib/api/schemas';

type Props = {
  projectId: string;
  finding: Finding;
};

// Audit `field` (server snapshot key) -> i18n label key under
// `findings.detail.history.fields`.
const FIELD_LABEL_KEY: Record<string, string> = {
  title: 'title',
  description: 'description',
  severity: 'severity',
  bbl_article_ref: 'bblArticleRef',
  assignee_user_id: 'assignee',
  deadline_date: 'deadline',
  resolution_note: 'resolutionNote',
  has_references: 'references',
  photo_count: 'photos',
  resolution_evidence_count: 'resolutionEvidence',
};

// Free-text fields render as "<label> edited" rather than dumping old/new text.
const LONG_TEXT_FIELDS = new Set(['title', 'description', 'resolution_note']);
const COUNT_FIELDS = new Set(['photo_count', 'resolution_evidence_count']);

// Action codes (`finding.<key>`) that have a translated verb under
// `findings.detail.history.actions`.
const ACTION_VERB_KEYS = new Set([
  'created',
  'promoted',
  'resolved',
  'verified',
  'updated',
  'deleted',
]);

/**
 * History/audit tab for the finding modal — a chronological timeline built from
 * the per-finding audit log (`useFindingHistory`). Each entry shows the actor,
 * the action, the timestamp, and the field-level changes the API diffed out of
 * the audit snapshots ("changed deadline", "added a photo", "severity → high").
 */
export function FindingHistoryTab({ projectId, finding }: Props): JSX.Element {
  const t = useTranslations('findings.detail.history');
  const tDetail = useTranslations('findings.detail');
  const tSeverity = useTranslations('findings.severity');
  const locale = useLocale() as Locale;

  const history = useFindingHistory(projectId, finding.id);
  const members = useProjectMembers(projectId);

  const memberName = (userId: string): string => {
    const match = members.data?.find((m) => m.user_id === userId);
    return match?.full_name ?? match?.email ?? userId;
  };

  // Display a single side of a value transition for a given field.
  const displayValue = (field: string, raw: string | null): string => {
    if (field === 'assignee_user_id') {
      return raw === null ? tDetail('placeholders.assignee') : memberName(raw);
    }
    if (raw === null) return '—';
    if (field === 'severity' && (raw === 'low' || raw === 'medium' || raw === 'high')) {
      return tSeverity(raw);
    }
    if (field === 'deadline_date') return formatDate(raw, locale);
    return raw;
  };

  // One human line per field change.
  const changeText = (c: FindingHistoryChange): string => {
    const labelKey = FIELD_LABEL_KEY[c.field];
    const label = labelKey !== undefined ? t(`fields.${labelKey}`) : c.field;

    if (LONG_TEXT_FIELDS.has(c.field)) return `${label} · ${t('edited')}`;
    if (c.field === 'has_references') {
      return `${label} · ${c.to_value === 'true' ? t('added') : t('removed')}`;
    }
    if (COUNT_FIELDS.has(c.field)) {
      return `${label} · ${c.from_value ?? '0'} → ${c.to_value ?? '0'}`;
    }
    return `${label} · ${displayValue(c.field, c.from_value)} → ${displayValue(c.field, c.to_value)}`;
  };

  const actionVerb = (action: string): string => {
    const key = action.replace('finding.', '');
    // Falls back to the raw action for any code without a translated verb.
    return ACTION_VERB_KEYS.has(key) ? t(`actions.${key}`) : action;
  };

  if (history.isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <div className="h-6 w-6 shrink-0 rounded-full bg-surface-high" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-surface-high" />
              <div className="h-2.5 w-1/3 rounded bg-surface-high" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const entries = history.data ?? [];
  if (entries.length === 0) {
    return (
      <div className="px-2 py-8 text-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-0 py-1">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-3">
            {/* Rail: dot + connector line */}
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />
              {!isLast && <span className="w-px flex-1 bg-border" />}
            </div>

            <div className="min-w-0 flex-1 pb-4">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="text-body3 font-semibold text-foreground">
                  {entry.actor_name ?? t('system')}
                </span>
                <span className="text-body3 text-foreground-secondary">
                  {actionVerb(entry.action)}
                </span>
                <span className="ml-auto whitespace-nowrap text-caption text-foreground-tertiary tabular-nums">
                  {formatDateTime(entry.created_at, locale)}
                </span>
              </div>

              {entry.changes.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {entry.changes.map((c) => (
                    <li
                      key={c.field}
                      className="text-caption text-foreground-tertiary tabular-nums"
                    >
                      {changeText(c)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
