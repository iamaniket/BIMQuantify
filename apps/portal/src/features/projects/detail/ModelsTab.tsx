'use client';

import {
  Box, Download, FileText, Layers, Plus, ShieldCheck, Trash2,
} from '@bimstitch/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button, Checkbox, ConfirmDialog, EmptyState, Select, SplitButton, type SplitButtonItem,
} from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Model, ModelDisciplineValue, ProjectFile } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/models/NewModelDialog';
import { useDeleteModel } from '@/features/models/useDeleteModel';
import { useModelsWithVersions } from '@/features/models/useModelsWithVersions';
import { useProjectPermissions } from '@/features/permissions';
import { setViewerTarget, type ViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { triggerComplianceCheck } from '@/lib/api/compliance';
import { getDownloadUrl } from '@/lib/api/projectFiles';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/providers/AuthProvider';

import { ModelActionPill } from './ModelActionPill';
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
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  const { can } = useProjectPermissions(projectId);
  const canCreateModel = can('model', 'create');
  const canRemoveModel = can('model', 'delete');
  const deleteMutation = useDeleteModel();

  // Checkbox selection drives the bulk-action bar (federated load, check, …).
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | 'check' | 'download'>(null);

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
  const clearSelection = (): void => { setSelectedModelIds(new Set()); };
  const allSelected = models.length > 0 && selectedModelIds.size === models.length;
  const someSelected = selectedModelIds.size > 0 && !allSelected;
  const toggleAll = (): void => {
    if (selectedModelIds.size > 0) clearSelection();
    else setSelectedModelIds(new Set(models.map((m) => m.id)));
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

  // Selection-derived subsets — each bulk action targets only the models it can act on.
  const selectedModels = models.filter((m) => selectedModelIds.has(m.id));
  const loadableSelected = selectedModels.filter((m) => isLoadable(m.id));
  const checkableSelected = selectedModels.filter((m) => {
    const f = latestFileOf(m.id);
    return f?.file_type === 'ifc' && f.extraction_status === 'succeeded';
  });
  const downloadableSelected = selectedModels.filter((m) => latestFileOf(m.id) !== undefined);

  const loadSelected = (): void => {
    if (loadableSelected.length === 0) return;
    goViewer({ kind: 'models', modelIds: loadableSelected.map((m) => m.id) });
  };

  const bulkCheckBbl = (): void => {
    if (tokens === null || checkableSelected.length === 0) return;
    const accessToken = tokens.access_token;
    const targets = checkableSelected
      .map((m) => {
        const f = latestFileOf(m.id);
        return f === undefined ? null : { modelId: m.id, fileId: f.id };
      })
      .filter((x): x is { modelId: string; fileId: string } => x !== null);
    setBulkBusy('check');
    void Promise.allSettled(
      targets.map((tg) => triggerComplianceCheck(accessToken, projectId, tg.modelId, tg.fileId)),
    ).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compliance'] });
      setBulkBusy(null);
    });
  };

  const bulkDownload = (): void => {
    if (tokens === null || downloadableSelected.length === 0) return;
    const accessToken = tokens.access_token;
    setBulkBusy('download');
    // One presigned download per file — the browser may throttle extra tabs.
    void Promise.allSettled(
      downloadableSelected.map(async (m) => {
        const f = latestFileOf(m.id);
        if (f === undefined) return;
        const resp = await getDownloadUrl(accessToken, projectId, m.id, f.id);
        window.open(resp.download_url, '_blank', 'noopener,noreferrer');
      }),
    ).then(() => { setBulkBusy(null); });
  };

  const bulkRemove = (): void => {
    const ids = selectedModels.map((m) => m.id);
    void Promise.allSettled(
      ids.map((modelId) => deleteMutation.mutateAsync({ projectId, modelId })),
    ).then(() => {
      clearSelection();
      setConfirmBulkRemove(false);
    });
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
            {canLoadAll ? (
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
                variant="border"
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

      {selectedModelIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary bg-primary-lighter px-3 py-2">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={toggleAll}
            aria-label={t('selectedCount', { count: selectedModelIds.size })}
          />
          <span className="text-body3 font-semibold text-primary">
            {t('selectedCount', { count: selectedModelIds.size })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={loadableSelected.length === 0}
              onClick={loadSelected}
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" />
              {t('loadSelected', { count: selectedModelIds.size })}
            </Button>
            <ModelActionPill
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              label={t('bulkCheckBbl')}
              disabled={checkableSelected.length === 0 || bulkBusy !== null}
              pending={bulkBusy === 'check'}
              onClick={bulkCheckBbl}
            />
            <ModelActionPill
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('bulkDownload')}
              disabled={downloadableSelected.length === 0 || bulkBusy !== null}
              pending={bulkBusy === 'download'}
              onClick={bulkDownload}
            />
            {canRemoveModel && (
              <ModelActionPill
                tone="danger"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t('bulkRemove')}
                onClick={() => { setConfirmBulkRemove(true); }}
              />
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md px-2 py-1 text-body3 font-semibold text-foreground-tertiary transition-colors hover:text-foreground"
            >
              {t('clearSelection')}
            </button>
          </div>
        </div>
      )}

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

      <ConfirmDialog
        open={confirmBulkRemove}
        onOpenChange={(open) => { if (!open) setConfirmBulkRemove(false); }}
        title={t('bulkRemoveTitle', { count: selectedModelIds.size })}
        description={t('bulkRemoveBody', { count: selectedModelIds.size })}
        confirmLabel={t('bulkRemoveConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={bulkRemove}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={deleteMutation.error?.message ?? null}
      />
    </div>
  );
}
