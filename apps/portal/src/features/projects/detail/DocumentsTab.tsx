'use client';

import {
  Box, FileText, Layers, Plus,
} from '@bimdossier/ui/icons';
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button, EmptyState, Select, SplitButton, type SplitButtonItem,
} from '@bimdossier/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import type { Document, Level, ModelDisciplineValue, ProjectFile } from '@/lib/api/schemas';
import { useProjectLevels } from '@/features/levels/hooks';
import { LevelAssignSelect } from '@/features/levels/LevelAssignSelect';
import { NewDocumentDialog } from '@/features/documents/NewDocumentDialog';
import { useDocumentsWithVersions } from '@/features/documents/useDocumentsWithVersions';
import { useProjectPermissions } from '@/features/permissions';
import { setViewerTarget, type ViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { useRouter } from '@/i18n/navigation';

import { DocumentsTableRow } from './DocumentsTableRow';

type Props = {
  projectId: string;
  documents: Document[];
};

const DISCIPLINE_FILTERS: { value: ModelDisciplineValue | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'architectural', labelKey: 'filterArchitectural' },
  { value: 'structural', labelKey: 'filterStructural' },
  { value: 'mep', labelKey: 'filterMep' },
  { value: 'coordination', labelKey: 'filterCoordination' },
  { value: 'other', labelKey: 'filterOther' },
];

/** A 2D drawing document belongs to a level; an IFC (or not-yet-typed) document does not. */
function is2dDocument(m: Document): boolean {
  return (
    m.primary_file_type === 'pdf'
    || m.primary_file_type === 'dxf'
    || m.primary_file_type === 'dwg'
  );
}

export function DocumentsTab({ projectId, documents }: Props): JSX.Element {
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState<ModelDisciplineValue | undefined>(undefined);
  const t = useTranslations('projectDetail.tabs.documents');
  const router = useRouter();
  const { can } = useProjectPermissions(projectId);
  const canCreateDocument = can('document', 'create');

  // Checkbox selection turns the "Load all" button into "Load selected".
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());

  // Fetch all documents with their file versions in a single API call.
  const documentsWithVersionsQuery = useDocumentsWithVersions(projectId, true);
  const filesMap = new Map<string, ProjectFile[]>();
  for (const m of documentsWithVersionsQuery.data ?? []) {
    filesMap.set(m.id, m.versions);
  }

  // Project levels — the spine that 2D drawings group under.
  const levelsQuery = useProjectLevels(projectId);
  const levels = useMemo(() => levelsQuery.data ?? [], [levelsQuery.data]);

  const latestFileOf = (documentId: string): ProjectFile | undefined => {
    const files = filesMap.get(documentId);
    return files !== undefined && files.length > 0 ? files[0] : undefined;
  };

  // Only IFC documents with a ready extraction can join a federated 3D scene.
  const isLoadable = (documentId: string): boolean => {
    const latest = latestFileOf(documentId);
    return latest?.file_type === 'ifc'
      && latest.extraction_status === 'succeeded';
  };

  // Load-capability tallies driving the "Load all" split button.
  const ifcDocumentCount = documents.filter((m) => latestFileOf(m.id)?.file_type === 'ifc').length;
  const canLoad3d = documents.some((m) => isLoadable(m.id));
  // PDF "2D" documents whose latest file is a ready document. Bulk 2D load is only
  // offered when there's exactly one — the viewer has no multi-PDF scene.
  const readyPdfTargets: { modelId: string; fileId: string }[] = [];
  for (const m of documents) {
    const f = latestFileOf(m.id);
    if (f?.file_type === 'pdf' && f.status === 'ready') {
      readyPdfTargets.push({ modelId: m.id, fileId: f.id });
    }
  }
  const single2d = readyPdfTargets.length === 1 ? readyPdfTargets[0]! : null;

  const toggleSelected = (documentId: string): void => {
    setSelectedDocumentIds((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
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
  // Main click: 3D when any document can federate, else the lone 2D document.
  const loadAllSmart = (): void => {
    if (canLoad3d) loadAll3d();
    else if (single2d !== null) loadAll2d();
  };

  const loadItems: SplitButtonItem[] = [];
  if (ifcDocumentCount > 0) {
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
  const loadableSelected = documents.filter((m) => selectedDocumentIds.has(m.id) && isLoadable(m.id));

  const loadSelected = (): void => {
    if (loadableSelected.length === 0) return;
    goViewer({ kind: 'models', modelIds: loadableSelected.map((m) => m.id) });
  };

  const filtered = documents.filter((m) => {
    if (disciplineFilter && m.discipline !== disciplineFilter) return false;
    if (searchQuery !== '' && !m.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const renderRow = (m: Document): JSX.Element => (
    <DocumentsTableRow
      key={m.id}
      projectId={projectId}
      document={m}
      prefetchedFiles={filesMap.get(m.id)}
      isOpen={expandedId === m.id}
      onToggle={() => { setExpandedId(expandedId === m.id ? null : m.id); }}
      selected={selectedDocumentIds.has(m.id)}
      onSelectToggle={() => { toggleSelected(m.id); }}
      levelControl={
        is2dDocument(m) ? (
          <LevelAssignSelect
            projectId={projectId}
            documentId={m.id}
            levelId={m.level_id ?? null}
            levels={levels}
          />
        ) : undefined
      }
    />
  );

  // Group: 3D/untyped documents first (ungrouped), then 2D drawings under their
  // level, then an "Unassigned" bucket. Flat (legacy) when there's nothing 2D
  // and no levels, so a pure-3D project looks unchanged.
  const twoD = filtered.filter(is2dDocument);
  const grouped = twoD.length > 0 || levels.length > 0;

  const listChildren = ((): ReactNode => {
    if (!grouped) return filtered.map(renderRow);

    const top = filtered.filter((m) => !is2dDocument(m));
    const byLevel = new Map<string, Document[]>();
    const unassigned: Document[] = [];
    for (const m of twoD) {
      if (m.level_id == null) { unassigned.push(m); continue; }
      const bucket = byLevel.get(m.level_id) ?? [];
      bucket.push(m);
      byLevel.set(m.level_id, bucket);
    }

    const sections: ReactNode[] = [];
    if (top.length > 0) {
      sections.push(
        <GroupHeader key="hdr-3d" label={t('group.models3d')} count={top.length} />,
        ...top.map(renderRow),
      );
    }
    for (const lvl of levels) {
      const rows = byLevel.get(lvl.id) ?? [];
      if (rows.length === 0) continue;
      sections.push(
        <GroupHeader key={`hdr-${lvl.id}`} label={lvl.name} count={rows.length} />,
        ...rows.map(renderRow),
      );
    }
    if (unassigned.length > 0) {
      sections.push(
        <GroupHeader key="hdr-unassigned" label={t('group.unassigned')} count={unassigned.length} />,
        ...unassigned.map(renderRow),
      );
    }
    return sections;
  })();

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
            {selectedDocumentIds.size > 0 ? (
              <Button
                variant="primary"
                size="md"
                disabled={loadableSelected.length === 0}
                onClick={loadSelected}
              >
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                {t('loadSelected', { count: selectedDocumentIds.size })}
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
            {canCreateDocument ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => { setNewDocumentOpen(true); }}
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
          total={documents.length}
          filteredCount={filtered.length}
          searchActive={searchQuery !== '' || disciplineFilter !== undefined}
          noResultsLabel={t('noResults')}
          empty={(
            <EmptyState
              icon={Box}
              title={t('emptyState')}
              description={t('emptyDescription')}
              action={canCreateDocument ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => { setNewDocumentOpen(true); }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t('newModel')}
                </Button>
              ) : undefined}
              className={undefined}
            />
          )}
        >
          {listChildren}
        </ResourceList>
      </div>

      <NewDocumentDialog
        open={newDocumentOpen}
        onOpenChange={setNewDocumentOpen}
        projectId={projectId}
      />
    </div>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-3 first:pt-0">
      <Layers className="h-3.5 w-3.5 text-foreground-tertiary" aria-hidden />
      <span className="text-caption font-semibold uppercase tracking-wide text-foreground-secondary">
        {label}
      </span>
      <span className="rounded-full bg-surface-high px-1.5 py-0.5 text-micro font-semibold tabular-nums text-foreground-tertiary">
        {count}
      </span>
    </div>
  );
}
