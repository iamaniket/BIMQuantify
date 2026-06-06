'use client';

import { AlertTriangle, Columns3, Plus } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { Button, EmptyState, SplitButton } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useFindings } from '@/features/findings/useFindings';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding } from '@/lib/api/schemas';

import { useRouter } from '@/i18n/navigation';

import { FindingDetailModal } from './FindingDetailModal';
import { FindingFormDialog } from './FindingFormDialog';
import { FindingRow } from './FindingRow';

type Props = {
  projectId: string;
};

export function BevindingenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.bevindingen');
  const findingsQuery = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const members = membersQuery.data ?? [];

  const getAssigneeName = useCallback(
    (userId: string | null): string | null => {
      if (userId === null) return null;
      const member = members.find((m) => m.user_id === userId);
      return member?.full_name ?? member?.email ?? null;
    },
    [members],
  );

  const allFindings = findingsQuery.data ?? [];
  const findings = searchQuery === ''
    ? allFindings
    : allFindings.filter((f) => {
        const q = searchQuery.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          (f.bbl_article_ref?.toLowerCase().includes(q) ?? false)
        );
      });

  const handleDelete = useCallback(
    (finding: Finding) => {
      deleteMutation.mutate(finding.id, {
        onSuccess: () => {
          if (expandedId === finding.id) setExpandedId(null);
        },
      });
    },
    [deleteMutation, expandedId],
  );

  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        actions={(
          <>
            {allFindings.length > 0 ? (
              <SplitButton
                label={t('boardLabel')}
                icon={<Columns3 className="mr-1.5 h-3.5 w-3.5" />}
                onClick={() => { router.push(`/projects/${projectId}/findings`); }}
                variant="primary"
                size="sm"
                menuLabel={t('ctaLabel')}
                items={[
                  {
                    id: 'log-finding',
                    label: t('ctaLabel'),
                    icon: <Plus className="h-3.5 w-3.5" />,
                    onSelect: () => { setCreateOpen(true); },
                  },
                ]}
              />
            ) : (
              <Button variant="primary" size="sm" onClick={() => { setCreateOpen(true); }}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('ctaLabel')}
              </Button>
            )}
          </>
        )}
      />

      <ResourceList
        isLoading={findingsQuery.isLoading}
        total={allFindings.length}
        filteredCount={findings.length}
        searchActive={searchQuery !== ''}
        noResultsLabel={t('noResults')}
        empty={(
          <EmptyState
            icon={AlertTriangle}
            title={t('title')}
            description={t('description')}
            action={(
              <Button variant="primary" size="sm" onClick={() => { setCreateOpen(true); }}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('ctaLabel')}
              </Button>
            )}
            className={undefined}
          />
        )}
      >
        {findings.map((finding) => (
          <FindingRow
            key={finding.id}
            finding={finding}
            assigneeName={getAssigneeName(finding.assignee_user_id)}
            expanded={expandedId === finding.id}
            onToggle={() => { setExpandedId(expandedId === finding.id ? null : finding.id); }}
            onView={() => { setSelected(finding); }}
            onDelete={() => { handleDelete(finding); }}
            deleteDisabled={deleteMutation.isPending}
          />
        ))}
      </ResourceList>

      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
