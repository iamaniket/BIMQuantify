'use client';

import { Box, CalendarDays, FileText, Flag, Image as ImageIcon, LinkIcon, Plus, User } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Button, IconTile, MediaRow } from '@bimdossier/ui';

import { UserAvatar } from '@/components/shared/UserAvatar';
import { useFindings } from '@/features/findings/useFindings';
import { useProjectPermissions } from '@/features/permissions';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding, FindingStatusValue, ProjectMember } from '@/lib/api/schemas';
import { formatAgo, formatDateTime, formatMonthDay } from '@/lib/formatting/dates';
import { totalFromPages } from '@/lib/query/useAuthInfiniteQuery';
import type { Locale } from '@bimdossier/i18n';

import { FindingDetailModal } from '../FindingDetailModal';
import { FindingFormDialog } from '../FindingFormDialog';
import { severityBadgeVariant } from '../findingBadges';
import { LauncherPanel } from './LauncherPanel';

/** Target up to 4 preview rows; the panel shows as many as the height allows.
 * ROW_HEIGHT_PX is the *minimum* row height used to decide how many fit — the
 * rendered rows then stretch (flex-1, capped) to fill the body with no dead gap.
 * Each row is two text lines (title 16px + description 12px = ~30px of content),
 * with the status / location / deadline / updated metadata laid out as
 * fixed-width columns in the trailing slot — so a compact 34px comfortably
 * covers both lines and lets all 4 rows fit the card body. */
const MAX_ROWS = 4;
const ROW_HEIGHT_PX = 34;

/** Status → dot colour, mirroring statusBadgeVariant's tones. */
const STATUS_DOT: Record<FindingStatusValue, string> = {
  draft: 'bg-foreground-tertiary',
  open: 'bg-info',
  in_progress: 'bg-primary',
  resolved: 'bg-success',
  verified: 'bg-success',
};

export function FindingsLauncherCard({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const tRow = useTranslations('findings.row');
  const locale = useLocale() as Locale;
  const { can } = useProjectPermissions(projectId);
  const query = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);

  const [selected, setSelected] = useState<Finding | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const recent = query.data?.pages[0]?.data.slice(0, MAX_ROWS) ?? [];
  const count = totalFromPages(query.data);

  // Resolve assignee / reporter user ids → member rows for avatar display.
  const memberById = useMemo(
    () => new Map<string, ProjectMember>((membersQuery.data ?? []).map((m) => [m.user_id, m])),
    [membersQuery.data],
  );

  /** Resolve "where is this anchored" into an icon + label for its own column, or
   * null when the finding isn't linked to any file/element. */
  const resolveLocation = (f: Finding): { icon: JSX.Element; label: string } | null => {
    let icon: JSX.Element | null = null;
    let label: string | null = null;
    switch (f.linked_file_type) {
      case 'ifc':
        if (f.linked_element_global_id !== null) {
          icon = <Box className="h-3 w-3" aria-hidden />;
          label = 'IFC';
        }
        break;
      case 'pdf':
        icon = <FileText className="h-3 w-3" aria-hidden />;
        label = f.anchor_page !== null ? `PDF ${tRow('page', { page: f.anchor_page })}` : 'PDF';
        break;
      case 'image':
        icon = <ImageIcon className="h-3 w-3" aria-hidden />;
        label = 'IMG';
        break;
      case 'dxf':
      case 'dwg':
        icon = <FileText className="h-3 w-3" aria-hidden />;
        label = f.linked_file_type.toUpperCase();
        break;
      default:
        break;
    }
    if (label === null && f.linked_document_id !== null) {
      icon = <LinkIcon className="h-3 w-3" aria-hidden />;
      label = tRow('linked');
    }
    if (icon === null || label === null) return null;
    return { icon, label };
  };

  const createAction = can('finding', 'create') ? (
    <Button variant="primary" size="md" onClick={() => { setCreateOpen(true); }}>
      <Plus className="h-3.5 w-3.5" />
      {t('nav.new')}
    </Button>
  ) : undefined;

  return (
    <>
      <LauncherPanel
        icon={<Flag className="h-4 w-4" />}
        label={t('bevindingen.label')}
        count={count}
        boardHref={`/projects/${projectId}/findings`}
        viewAllLabel={t('nav.viewAll')}
        headerAction={createAction}
        emptyLabel={t('nav.empty')}
        isLoading={query.isLoading}
        isEmpty={recent.length === 0}
        rowHeightPx={ROW_HEIGHT_PX}
        maxRows={MAX_ROWS}
      >
        {(visible) => recent.slice(0, visible).map((f) => {
          // The user calls this "last updated", so age tracks updated_at, not creation.
          const updatedSeconds = (Date.now() - new Date(f.updated_at).getTime()) / 1000;
          const overdue = f.deadline_date !== null
            && f.status !== 'resolved' && f.status !== 'verified'
            && new Date(f.deadline_date).getTime() < Date.now();
          const location = resolveLocation(f);
          // Show the assignee, falling back to whoever logged it (Drafts are
          // usually unassigned) so a row always names a person.
          const assignee = f.assignee_user_id !== null
            ? memberById.get(f.assignee_user_id)
            : undefined;
          const person = assignee ?? memberById.get(f.created_by_user_id);
          const isReporter = assignee === undefined && person !== undefined;
          const personName = person !== undefined ? (person.full_name ?? person.email) : '';
          return (
            <MediaRow
              key={f.id}
              className="min-h-[34px] max-h-[48px] flex-1"
              media={<IconTile tone="neutral" size="md"><Flag className="h-4 w-4" /></IconTile>}
              title={f.title}
              description={f.description}
              // Metadata is no longer a stacked subtitle line: status / location /
              // deadline / last-updated are laid out as fixed-width columns that
              // align row-to-row, using the card's spare horizontal space.
              trailing={(
                <div className="flex items-center gap-3 text-caption text-foreground-tertiary">
                  <span className="flex w-[84px] min-w-0 items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[f.status]}`}
                      aria-hidden
                    />
                    <span className="truncate">{tStatus(f.status)}</span>
                  </span>
                  <span className="flex w-[68px] min-w-0 items-center gap-1">
                    {location !== null && (
                      <>
                        {location.icon}
                        <span className="truncate">{location.label}</span>
                      </>
                    )}
                  </span>
                  <span className={`flex w-[68px] min-w-0 items-center gap-1 ${overdue ? 'text-error' : ''}`}>
                    {f.deadline_date !== null && (
                      <>
                        <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{formatMonthDay(f.deadline_date, locale)}</span>
                      </>
                    )}
                  </span>
                  <span
                    className="w-[52px] shrink-0 whitespace-nowrap text-right"
                    title={formatDateTime(f.updated_at, locale)}
                  >
                    {formatAgo(updatedSeconds, locale)}
                  </span>
                  <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
                  {person !== undefined ? (
                    <UserAvatar
                      name={person.full_name ?? ''}
                      email={person.email}
                      size="sm"
                      title={isReporter ? `${personName} · ${tRow('reporter')}` : undefined}
                    />
                  ) : (
                    <span
                      title={tRow('unassigned')}
                      aria-label={tRow('unassigned')}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-foreground-tertiary"
                    >
                      <User className="h-3 w-3" aria-hidden />
                    </span>
                  )}
                  <Badge variant={severityBadgeVariant(f.severity)} size="sm">
                    {tSeverity(f.severity)}
                  </Badge>
                </div>
              )}
              showChevron
              onClick={() => { setSelected(f); }}
            />
          );
        })}
      </LauncherPanel>

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}
