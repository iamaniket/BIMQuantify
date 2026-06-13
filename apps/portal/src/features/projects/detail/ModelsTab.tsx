'use client';

import { Box, Layers, Plus } from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button, EmptyState, Select } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Model, ModelDisciplineValue, ProjectFile } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/models/NewModelDialog';
import { useModelsWithVersions } from '@/features/models/useModelsWithVersions';
import { useProjectPermissions } from '@/features/permissions';
import { setViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { useRouter } from '@/i18n/navigation';

import { ModelsTableRow } from './ModelsTableRow';

type Props = {
  projectId: string;
  models: Model[];
};

const DISCIPLINE_FILTERS: { value: ModelDisciplineValue | 'all'; labelKey: string }[] = [
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
  const router = useRouter();
  const { can } = useProjectPermissions(projectId);
  const canCreateModel = can('model', 'create');

  // Checkbox selection for "Load selected" (federated multi-model viewing).
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  // Fetch all models with their file versions in a single API call.
  const modelsWithVersionsQuery = useModelsWithVersions(projectId, true);
  const filesMap = new Map<string, ProjectFile[]>();
  for (const m of modelsWithVersionsQuery.data ?? []) {
    filesMap.set(m.id, m.versions);
  }

  // Only IFC models with a ready extraction can join a federated 3D scene.
  const isLoadable = (modelId: string): boolean => {
    const files = filesMap.get(modelId);
    const latest = files !== undefined && files.length > 0 ? files[0] : undefined;
    return latest?.file_type === 'ifc'
      && latest.extraction_status === 'succeeded';
  };

  const toggleSelected = (modelId: string): void => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const loadSelected = (): void => {
    if (selectedModelIds.size === 0) return;
    setViewerTarget(projectId, { kind: 'models', modelIds: [...selectedModelIds] });
    router.push(`/projects/${projectId}/viewer`);
  };

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
            selectSize="md"
            value={disciplineFilter ?? 'all'}
            onChange={(e) => { setDisciplineFilter(e.target.value === 'all' ? undefined : e.target.value as ModelDisciplineValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            {DISCIPLINE_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={(
          <div className="flex items-center gap-2">
            {selectedModelIds.size > 0 ? (
              <Button variant="border" size="md" onClick={loadSelected}>
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                {t('loadSelected', { count: selectedModelIds.size })}
              </Button>
            ) : null}
            {canCreateModel ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => { setNewModelOpen(true); }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('newModel')}
              </Button>
            ) : null}
          </div>
        )}
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
            action={canCreateModel ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => { setNewModelOpen(true); }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('newModel')}
              </Button>
            ) : undefined}
            className={undefined}
          />
        )}
      >
        {filtered.map((m) => (
          <ModelsTableRow
            key={m.id}
            projectId={projectId}
            model={m}
            prefetchedFiles={filesMap.get(m.id)}
            isOpen={expandedId === m.id}
            onToggle={() => { setExpandedId(expandedId === m.id ? null : m.id); }}
            selectable={isLoadable(m.id)}
            selected={selectedModelIds.has(m.id)}
            onSelectToggle={() => { toggleSelected(m.id); }}
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
