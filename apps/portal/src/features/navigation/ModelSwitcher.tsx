'use client';

import { useQueries } from '@tanstack/react-query';
import { ChevronDown } from '@bimstitch/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Spinner,
} from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { useRouter } from '@/i18n/navigation';
import { getModel } from '@/lib/api/models';
import type { Model, ModelWithVersions, ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';
import { kindForFormat, type ViewerFormat, type ViewerKind } from '@/components/shared/viewer/shared/viewerMode';

import { useModels } from '../models/useModels';
import { modelKey } from '../models/queryKeys';

type ModelSwitcherItem = {
  id: string;
  name: string;
  viewerKind: ViewerKind | null;
  latestViewableFileId: string | null;
  isCurrent: boolean;
};

function latestViewableFile(versions: ProjectFile[]): ProjectFile | undefined {
  return versions.find((f) =>
    f.file_type === 'pdf'
      ? f.status === 'ready'
      : f.extraction_status === 'succeeded',
  );
}

function buildItems(
  models: Model[],
  details: (ModelWithVersions | undefined)[],
  currentModelId: string,
): ModelSwitcherItem[] {
  return models.map((m, i) => {
    const detail = details[i];
    const viewable = detail !== undefined ? latestViewableFile(detail.versions) : undefined;
    const fileType = viewable?.file_type ?? m.primary_file_type ?? null;
    return {
      id: m.id,
      name: m.name,
      viewerKind: fileType !== null ? kindForFormat(fileType as ViewerFormat) : null,
      latestViewableFileId: viewable?.id ?? null,
      isCurrent: m.id === currentModelId,
    };
  });
}

function KindBadge({ kind }: { kind: ViewerKind }): JSX.Element {
  return (
    <span
      className={
        'inline-flex h-[18px] items-center rounded px-1 text-[10px] font-bold uppercase leading-none tracking-wide '
        + (kind === '3d'
          ? 'bg-primary/15 text-primary'
          : 'bg-warning/15 text-warning')
      }
    >
      {kind === '3d' ? '3D' : '2D'}
    </span>
  );
}

type Props = {
  projectId: string;
  currentModelId: string;
  currentModelName: string;
};

export function ModelSwitcher({ projectId, currentModelId, currentModelName }: Props): JSX.Element {
  const t = useTranslations('modelSwitcher');
  const router = useRouter();
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const [open, setOpen] = useState(false);

  const modelsQuery = useModels(projectId);
  const models = modelsQuery.data ?? [];

  const detailQueries = useQueries({
    queries: models.map((m) => ({
      queryKey: modelKey(projectId, m.id),
      queryFn: async () => {
        if (accessToken === null) throw new Error('Not authenticated');
        return getModel(accessToken, projectId, m.id);
      },
      enabled: open && accessToken !== null,
      staleTime: 60_000,
    })),
  });

  const allLoaded = detailQueries.length > 0 && detailQueries.every((q) => q.data !== undefined);
  const items = buildItems(
    models,
    detailQueries.map((q) => q.data),
    currentModelId,
  );

  const handleSelect = useCallback(
    (item: ModelSwitcherItem) => {
      if (item.latestViewableFileId === null || item.isCurrent) return;
      setOpen(false);
      router.push(`/projects/${projectId}/models/${item.id}/viewer/${item.latestViewableFileId}`);
    },
    [projectId, router],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-[140px] items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2.5 text-body3 font-medium text-white outline-none hover:bg-white/15"
        >
          <span className="min-w-0 flex-1 truncate text-left">{currentModelName}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-white/70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>{t('switchModel')}</DropdownMenuLabel>

        {!allLoaded && open ? (
          <div className="flex items-center justify-center py-3">
            <Spinner size="sm" className="text-foreground-tertiary" />
          </div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              disabled={item.latestViewableFileId === null}
              onSelect={() => { handleSelect(item); }}
              className="gap-2"
            >
              {item.viewerKind !== null ? (
                <KindBadge kind={item.viewerKind} />
              ) : (
                <span className="inline-flex h-[18px] w-5" />
              )}
              <span className="min-w-0 flex-1 truncate text-body3">{item.name}</span>
              {item.latestViewableFileId === null ? (
                <span className="shrink-0 text-micro text-foreground-disabled">
                  {t('noViewableFile')}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
