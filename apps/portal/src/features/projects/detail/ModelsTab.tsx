'use client';

import {
  Box, FileText, Layers, Plus,
} from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button, EmptyState, Select, SplitButton, type SplitButtonItem,
} from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Model, ModelDisciplineValue, ProjectFile } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/models/NewModelDialog';
import { useModelsWithVersions } from '@/features/models/useModelsWithVersions';
import { useProjectPermissions } from '@/features/permissions';
import { setViewerTarget, type ViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
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

  // Checkbox selection turns the "Load all" button into "Load selected".
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  // Fetch all models with their file versions in a single API call.
  const modelsWithVersionsQuery = useModelsWithVersions(projectId, true);
  const filesMap = new Map<string, ProjectFile[]>();
  for (const m of modelsWithVersionsQuery.data ?? []) {
    filesMap.set(m.id, m.versions);
  }

  const latestFileOf = (modelId: string): ProjectFile | undefined => {
    const files = filesMap.get(modelId);
    return files !== undefined && files.length > 0 ? files[0] : undefined;
  };

  // Only IFC models with a ready extraction can join a federated 3D scene.
  const isLoadable = (modelId: string): boolean => {
    const latest = latestFileOf(modelId);
    return latest?.file_type === 'ifc'
      && latest.extraction_status === 'succeeded';
  };

  // Load-capability tallies driving the "Load all" split button.
  const ifcModelCount = models.filter((m) => latestFileOf(m.id)?.file_type === 'ifc').length;
  const canLoad3d = models.some((m) => isLoadable(m.id));
  // PDF "2D" models whose latest file is a ready document. Bulk 2D load is only
  // offered when there's exactly one — the viewer has no multi-PDF scene.
  const readyPdfTargets: { modelId: string; fileId: string }[] = [];
  for (const m of models) {
    const f = latestFileOf(m.id);
    if (f?.file_type === 'pdf' && f.status === 'ready') {
      readyPdfTargets.push({ modelId: m.id, fileId: f.id });
    }
  }
  const single2d = readyPdfTargets.length === 1 ? readyPdfTargets[0]! : null;

  const toggleSelected = (modelId: string): void => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const goViewer = (target: ViewerTarget): void => {
    setViewerTarget(projectId, target);
    router.push(`/projects/${projectId}/viewer`);
  };

  const loadAll3d = (): void => { goViewer({ kind: 'all' }); };
  const loadAll2d = (): void => {
    if (single2d === null) return;
    goViewer({ kind: 'single', modelId: single2d.modelId, fileId: single2d.fileId });
  };
  // Main click: 3D when any model can federate, else the lone 2D document.
  const loadAllSmart = (): void => {
    if (canLoad3d) loadAll3d();
    else if (single2d !== null) loadAll2d();
  };

  const loadItems: SplitButtonItem[] = [];
  if (ifcModelCount > 0) {
    loadItems.push({
      id: 'all-3d',
      label: t('loadAll3d'),
      icon: <Box className="h-4 w-4" />,
      onSelect: loadAll3d,
      disabled: !canLoad3d,
    });
  }
  if (single2d !== null) {
    loadItems.push({
      id: 'all-2d',
      label: t('loadAll2d'),
      icon: <FileText className="h-4 w-4" />,
      onSelect: loadAll2d,
    });
  }
  const canLoadAll = canLoad3d || single2d !== null;

  // Only the loadable subset of the selection can join a federated scene.
  const loadableSelected = models.filter((m) => selectedModelIds.has(m.id) && isLoadable(m.id));

  const loadSelected = (): void => {
    if (loadableSelected.length === 0) return;
    goViewer({ kind: 'models', modelIds: loadableSelected.map((m) => m.id) });
  };

  const filtered = models.filter((m) => {
    if (disciplineFilter && m.discipline !== disciplineFilter) return false;
    if (searchQuery !== '' && !m.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
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
              <Button
                variant="primary"
                size="md"
                disabled={loadableSelected.length === 0}
                onClick={loadSelected}
              >
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                {t('loadSelected', { count: selectedModelIds.size })}
              </Button>
            ) : canLoadAll ? (
              <SplitButton
                variant="primary"
                size="md"
                label={t('loadAll')}
                icon={<Layers className="h-3.5 w-3.5" />}
                onClick={loadAllSmart}
                items={loadItems}
                menuLabel={t('loadAllMenu')}
              />
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

      <div className="min-h-0 flex-1 overflow-auto">
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
              selected={selectedModelIds.has(m.id)}
              onSelectToggle={() => { toggleSelected(m.id); }}
            />
          ))}
        </ResourceList>
      </div>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
