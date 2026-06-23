'use client';

import { Search } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';

import { Input, Select, type KanbanColumnDef } from '@bimstitch/ui';
import { KanbanBoard } from '@bimstitch/ui';

import { AssigneeFilterChips, UNASSIGNED_FILTER } from '@/features/findings/AssigneeFilterChips';
import { FindingsExportActions } from '@/features/findings/FindingsExportActions';
import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { LogFindingButton } from '@/features/findingTemplates/LogFindingButton';
import { useProjectPermissions } from '@/features/permissions';
import { FindingDetailPanel } from '@/features/projects/detail/FindingDetailPanel';
import type { Finding, FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';
import type { ProjectMember } from '@/lib/api/schemas';

import { FindingKanbanCard } from './FindingKanbanCard';
import { isValidTransition, needsModal } from './kanbanTransitions';

const STATUSES: FindingStatusValue[] = ['draft', 'open', 'in_progress', 'resolved', 'verified'];

// Priority filter, ordered most-severe first.
const SEVERITIES: FindingSeverityValue[] = ['high', 'medium', 'low'];

const ACCENT_COLORS: Record<FindingStatusValue, string> = {
  draft: 'var(--foreground-tertiary)',
  open: 'var(--info)',
  in_progress: 'var(--primary)',
  resolved: 'var(--success)',
  verified: 'var(--success)',
};

type Props = {
  projectId: string;
  findings: Finding[];
  members: ProjectMember[];
};

export function FindingsKanbanBoard({ projectId, findings, members }: Props): JSX.Element {
  const t = useTranslations('findingsBoard');
  const tColumns = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const updateMutation = useUpdateFinding(projectId);
  const { can, canVerifyFinding } = useProjectPermissions(projectId);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverityValue | undefined>(undefined);
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());

  const canUpdateFinding = can('finding', 'update');

  const getAssigneeName = useCallback(
    (userId: string | null): string | null => {
      if (userId === null) return null;
      const member = members.find((m) => m.user_id === userId);
      return member?.full_name ?? member?.email ?? null;
    },
    [members],
  );

  const toggleAssignee = useCallback((id: string) => {
    setAssigneeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredFindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter && f.severity !== severityFilter) return false;
      if (assigneeFilter.size > 0 && !assigneeFilter.has(f.assignee_user_id ?? UNASSIGNED_FILTER)) {
        return false;
      }
      if (q !== '') {
        const hay = `${f.title} ${f.description} ${f.bbl_article_ref ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, assigneeFilter, severityFilter, search]);

  const columns: KanbanColumnDef[] = useMemo(
    () => STATUSES.map((s) => ({
      id: s,
      label: tColumns(s),
      accentColor: ACCENT_COLORS[s],
    })),
    [tColumns],
  );

  const canDrop = useCallback(
    (_itemId: string, from: string, to: string): boolean =>
      canUpdateFinding
      && isValidTransition(from as FindingStatusValue, to as FindingStatusValue, canVerifyFinding),
    [canUpdateFinding, canVerifyFinding],
  );

  const handleMove = useCallback(
    (itemId: string, from: string, to: string) => {
      const fromStatus = from as FindingStatusValue;
      const toStatus = to as FindingStatusValue;

      if (needsModal(fromStatus, toStatus)) {
        const finding = findings.find((f) => f.id === itemId);
        if (finding !== undefined) {
          setSelectedFinding(finding);
        }
        return;
      }

      updateMutation.mutate({ findingId: itemId, input: { status: toStatus } });
    },
    [findings, updateMutation],
  );

  const handleCardClick = useCallback(
    (item: Finding) => { setSelectedFinding(item); },
    [],
  );

  const renderCard = useCallback(
    (finding: Finding) => (
      <FindingKanbanCard
        finding={finding}
        assigneeName={getAssigneeName(finding.assignee_user_id)}
        reporterName={getAssigneeName(finding.created_by_user_id)}
      />
    ),
    [getAssigneeName],
  );

  const isItemDisabled = useCallback(
    (item: Finding) => item.status === 'verified',
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2.5 pt-0.5">
        <Input
          inputSize="md"
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          placeholder={t('searchPlaceholder')}
          leading={<Search className="h-3.5 w-3.5" />}
          className="w-full max-w-xs sm:w-56"
        />
        <AssigneeFilterChips
          members={members}
          selected={assigneeFilter}
          onToggle={toggleAssignee}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Select
            selectSize="md"
            value={severityFilter ?? 'all'}
            onChange={(e) => { setSeverityFilter(e.target.value === 'all' ? undefined : e.target.value as FindingSeverityValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            <option value="all">{t('filterAllPriorities')}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{tSeverity(s)}</option>
            ))}
          </Select>
          <FindingsExportActions
            projectId={projectId}
            members={members}
            severityFilter={severityFilter}
            assigneeFilter={assigneeFilter}
          />
          <LogFindingButton projectId={projectId} size="lg" variant="primary" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-x-auto px-3.5 pb-3.5">
          <KanbanBoard<Finding>
            columns={columns}
            items={filteredFindings}
            getItemColumn={(f) => f.status}
            getItemId={(f) => f.id}
            renderCard={renderCard}
            onMove={handleMove}
            canDrop={canDrop}
            emptyLabel={t('empty')}
            isItemDisabled={isItemDisabled}
            onCardClick={handleCardClick}
            cardClassName="overflow-hidden rounded-xl bg-surface-main p-0"
            className="h-full"
          />
        </div>

        <FindingDetailPanel
          projectId={projectId}
          finding={selectedFinding}
          onClose={() => { setSelectedFinding(null); }}
        />
      </div>
    </div>
  );
}
