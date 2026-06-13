'use client';

import { ChevronDown } from '@bimstitch/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import {
  setViewerTarget,
  useViewerTarget,
} from '@/features/viewer/shared/viewerSelectionStore';
import type { ModelWithVersions, ProjectFile } from '@/lib/api/schemas';
import { kindForFormat, type ViewerFormat, type ViewerKind } from '@/components/shared/viewer/shared/viewerMode';

import { useModelsWithVersions } from '../models/useModelsWithVersions';

type ModelSwitcherItem = {
  id: string;
  name: string;
  viewerKind: ViewerKind | null;
  /** IFC model with a ready file — only these can join a federated 3D scene. */
  loadable: boolean;
};

function latestViewableFile(versions: ProjectFile[]): ProjectFile | undefined {
  return versions.find((f) => (
    f.file_type === 'pdf'
      ? f.status === 'ready'
      : f.extraction_status === 'succeeded'
  ));
}

function buildItems(models: ModelWithVersions[]): ModelSwitcherItem[] {
  return models.map((m) => {
    const viewable = latestViewableFile(m.versions);
    const fileType = viewable?.file_type ?? m.primary_file_type ?? null;
    const viewerKind = fileType !== null ? kindForFormat(fileType) : null;
    return {
      id: m.id,
      name: m.name,
      viewerKind,
      loadable: viewerKind === '3d' && viewable !== undefined,
    };
  });
}

function KindBadge({ kind }: { kind: ViewerKind }): JSX.Element {
  return (
    <span
      className={
        `inline-flex h-[18px] items-center rounded px-1 text-[10px] font-bold uppercase leading-none tracking-wide ${
          kind === '3d'
            ? 'bg-primary/15 text-primary'
            : 'bg-warning/15 text-warning'}`
      }
    >
      {kind === '3d' ? '3D' : '2D'}
    </span>
  );
}

type Props = {
  projectId: string;
  /** Label shown on the trigger (active model name, or "All models"). */
  activeLabel: string;
};

/**
 * Multi-select model loader for the viewer header. Each IFC model has a
 * checkbox reflecting whether it is currently loaded; checking adds it to the
 * scene, unchecking removes it. Writes the selection store (the viewer URL stays
 * clean) — the viewer reacts and loads/unloads incrementally.
 */
export function ModelSwitcher({ projectId, activeLabel }: Props): JSX.Element {
  const t = useTranslations('modelSwitcher');
  const [open, setOpen] = useState(false);
  const target = useViewerTarget(projectId);

  const modelsQuery = useModelsWithVersions(projectId);
  const models = modelsQuery.data ?? [];
  const items = useMemo(() => buildItems(models), [models]);

  const loadableIds = useMemo(
    () => items.filter((i) => i.loadable).map((i) => i.id),
    [items],
  );

  const loadedIds = useMemo<Set<string>>(() => {
    if (target.kind === 'single') return new Set([target.modelId]);
    if (target.kind === 'models') return new Set(target.modelIds);
    return new Set(loadableIds); // 'all'
  }, [target, loadableIds]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(loadedIds);
      if (next.has(id)) {
        if (next.size <= 1) return; // keep at least one model loaded
        next.delete(id);
      } else {
        next.add(id);
      }
      setViewerTarget(projectId, { kind: 'models', modelIds: [...next] });
    },
    [loadedIds, projectId],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-[140px] items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2.5 text-body3 font-medium text-white outline-none hover:bg-white/15"
        >
          <span className="min-w-0 flex-1 truncate text-left">{activeLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-white/70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="max-h-80 w-[220px] overflow-y-auto p-1">
        {items.map((item) => {
          const checked = loadedIds.has(item.id);
          return (
            <label
              key={item.id}
              title={item.loadable ? item.name : t('noViewableFile')}
              className={
                `flex items-center gap-2 rounded px-2 py-1.5 text-body3 ${
                  item.loadable ? 'cursor-pointer hover:bg-background-hover' : 'cursor-not-allowed opacity-50'}`
              }
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!item.loadable}
                onChange={() => { toggle(item.id); }}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.viewerKind !== null ? (
                <KindBadge kind={item.viewerKind} />
              ) : null}
            </label>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
