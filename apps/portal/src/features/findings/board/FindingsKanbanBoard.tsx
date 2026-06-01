'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';

import { Button, type KanbanColumnDef } from '@bimstitch/ui';
import { KanbanBoard } from '@bimstitch/ui';

import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FindingFormDialog } from '@/features/projects/detail/FindingFormDialog';
import type { Finding, FindingStatusValue } from '@/lib/api/schemas';
import type { ProjectMember } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { FindingKanbanCard } from './FindingKanbanCard';
import { isValidTransition, needsModal } from './kanbanTransitions';

const STATUSES: FindingStatusValue[] = ['draft', 'open', 'in_progress', 'resolved', 'verified'];

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
  const updateMutation = useUpdateFinding(projectId);
  const { me } = useAuth();
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const currentUserId = me === null ? null : me.user.id;
  const isInspector = useMemo(
    () => members.some((m) => m.user_id === currentUserId && m.role === 'inspector'),
    [members, currentUserId],
  );

  const getAssigneeName = useCallback(
    (userId: string | null): string | null => {
      if (userId === null) return null;
      const member = members.find((m) => m.user_id === userId);
      return member?.full_name ?? member?.email ?? null;
    },
    [members],
  );

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
      isValidTransition(from as FindingStatusValue, to as FindingStatusValue, isInspector),
    [isInspector],
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
      <div className="flex items-center justify-end px-3.5 pb-2">
        <Button variant="border" size="sm" onClick={() => { setCreateOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('logFinding')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto px-3.5 pb-3.5">
        <KanbanBoard<Finding>
          columns={columns}
          items={findings}
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

      <FindingDetailModal
        projectId={projectId}
        finding={selectedFinding}
        open={selectedFinding !== null}
        onOpenChange={(o) => { if (!o) setSelectedFinding(null); }}
      />
      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
