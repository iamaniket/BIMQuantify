'use client';

import { AlertCircle, CalendarDays, CheckCircle, Clock, Eye, LinkIcon, Pencil, Trash2 } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentType, JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import {
  Badge,
  Button,
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
  MetaGrid,
} from '@bimstitch/ui';

import { ResourceMediaTile, RowAsideStat, type MediaTileTone } from '@/components/shared/resource';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding, FindingStatusValue } from '@/lib/api/schemas';

import { severityBadgeVariant, statusBadgeVariant } from './findingBadges';

const STATUS_ICON: Record<FindingStatusValue, { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; tone: MediaTileTone }> = {
  draft: { icon: Pencil, tone: 'neutral' },
  open: { icon: AlertCircle, tone: 'info' },
  in_progress: { icon: Clock, tone: 'primary' },
  resolved: { icon: CheckCircle, tone: 'success' },
  verified: { icon: CheckCircle, tone: 'success' },
};

type Props = {
  finding: Finding;
  assigneeName: string | null;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
};

export function FindingRow({
  finding,
  assigneeName,
  expanded,
  onToggle,
  onView,
  onDelete,
  deleteDisabled,
}: Props): JSX.Element {
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const tExpanded = useTranslations('findings.expanded');
  const locale = useLocale() as Locale;

  const entries: Array<{ label: string; value: string }> = [
    { label: tExpanded('status'), value: tStatus(finding.status) },
    { label: tExpanded('severity'), value: tSeverity(finding.severity) },
    { label: tExpanded('assignee'), value: assigneeName ?? tExpanded('noAssignee') },
  ];
  if (finding.deadline_date !== null) {
    entries.push({ label: tExpanded('deadline'), value: formatDate(finding.deadline_date, locale) });
  }
  if (finding.bbl_article_ref !== null && finding.bbl_article_ref !== '') {
    entries.push({ label: tExpanded('bblRef'), value: finding.bbl_article_ref });
  }
  if (finding.photo_ids !== null && finding.photo_ids.length > 0) {
    entries.push({ label: tExpanded('photos'), value: tExpanded('photoCount', { count: finding.photo_ids.length }) });
  }
  if (finding.linked_element_global_id !== null) {
    entries.push({ label: tExpanded('linkedElement'), value: tExpanded('linkedYes') });
  }
  entries.push({ label: tExpanded('created'), value: formatDate(finding.created_at, locale) });
  if (finding.updated_at !== finding.created_at) {
    entries.push({ label: tExpanded('updated'), value: formatDate(finding.updated_at, locale) });
  }

  return (
    <DetailCard expanded={expanded} onToggle={onToggle}>
      <DetailCardRow
        media={<ResourceMediaTile icon={STATUS_ICON[finding.status].icon} tone={STATUS_ICON[finding.status].tone} />}
        aside={
          <>
            {finding.linked_element_global_id !== null && (
              <RowAsideStat icon={LinkIcon} title={tExpanded('linkedYes')} />
            )}
            <RowAsideStat icon={CalendarDays} value={formatDate(finding.created_at, locale)} title={tExpanded('created')} />
          </>
        }
        actions={
          <button
            type="button"
            title={tExpanded('view')}
            onClick={(e) => { e.stopPropagation(); onView(); }}
            className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
          >
            <Eye className="h-4 w-4" />
          </button>
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-body3 font-semibold leading-tight text-foreground">
            {finding.title}
          </span>
          <Badge variant={severityBadgeVariant(finding.severity)} size="md" bordered>
            {tSeverity(finding.severity)}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          {assigneeName !== null && (
            <>
              <span className="truncate">{assigneeName}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          {finding.deadline_date !== null && (
            <>
              <span className="shrink-0">{formatDate(finding.deadline_date, locale)}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          {finding.bbl_article_ref !== null && finding.bbl_article_ref !== '' && (
            <>
              <span className="shrink-0">{finding.bbl_article_ref}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          <Badge variant={statusBadgeVariant(finding.status)} size="md" className="w-fit shrink-0">
            {tStatus(finding.status)}
          </Badge>
        </div>
      </DetailCardRow>

      <DetailCardBody>
        {finding.description !== '' && (
          <div className="whitespace-pre-wrap border-b border-dashed border-border py-2.5 text-body3 leading-snug text-foreground-secondary">
            {finding.description}
          </div>
        )}
        <MetaGrid entries={entries} />
      </DetailCardBody>

      <DetailCardFooter className="justify-between">
        <Button variant="ghost" size="md" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
          {tExpanded('view')}
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={onDelete}
          disabled={deleteDisabled}
          className="text-error hover:text-error"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {tExpanded('delete')}
        </Button>
      </DetailCardFooter>
    </DetailCard>
  );
}
