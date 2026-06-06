'use client';

import { Box, Plus } from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button, EmptyState, Select } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Model, ModelDisciplineValue } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/models/NewModelDialog';

import { ModelsTableRow } from './ModelsTableRow';

type Props = {
  projectId: string;
  models: Model[];
};

const DISCIPLINE_FILTERS: Array<{ value: ModelDisciplineValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'architectural', labelKey: 'filterArchitectural' },
  { value: 'structural', labelKey: 'filterStructural' },
  { value: 'mep', labelKey: 'filterMep' },
  { value: 'coordination', labelKey: 'filterCoordination' },
  { value: 'other', labelKey: 'filterOther' },
];

export function ModelsTab({ projectId, models }: Props): JSX.Element {
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState<ModelDisciplineValue | undefined>(undefined);
  const t = useTranslations('projectDetail.tabs.models');

  const filtered = models.filter((m) => {
    if (disciplineFilter && m.discipline !== disciplineFilter) return false;
    if (searchQuery !== '' && !m.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        filter={(
          <Select
            selectSize="sm"
            value={disciplineFilter ?? 'all'}
            onChange={(e) => { setDisciplineFilter(e.target.value === 'all' ? undefined : e.target.value as ModelDisciplineValue); }}
            className="w-auto shrink-0"
          >
            {DISCIPLINE_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setNewModelOpen(true); }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('newModel')}
          </Button>
        }
      />

      <ResourceList
        isLoading={false}
        total={models.length}
        filteredCount={filtered.length}
        searchActive={searchQuery !== '' || disciplineFilter !== undefined}
        noResultsLabel={t('noResults')}
        empty={(
          <EmptyState
            icon={Box}
            title={t('emptyState')}
            description={t('emptyDescription')}
            action={(
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setNewModelOpen(true); }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('newModel')}
              </Button>
            )}
            className={undefined}
          />
        )}
      >
        {filtered.map((m) => (
          <ModelsTableRow
            key={m.id}
            projectId={projectId}
            model={m}
            isOpen={expandedId === m.id}
            onToggle={() => { setExpandedId(expandedId === m.id ? null : m.id); }}
          />
        ))}
      </ResourceList>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
