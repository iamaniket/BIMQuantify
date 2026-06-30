'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { CaretDownIcon, ChevronLeft, ChevronRight, House, StackIcon } from '@bimdossier/ui/icons';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@bimdossier/ui';
import type { DocumentViewerHandle } from '@bimdossier/viewer';

import {
  ToolbarDivider,
  ToolbarGroup,
  ToolButton,
} from '@/components/shared/viewer/shared/_toolbarPrimitives';
import { headFileId } from '@/features/documents/headFileId';
import { useViewerBundle } from '@/features/viewer/shared/useViewerBundle';
import { UNASSIGNED_LEVEL, useDrawingScope } from '@/features/viewer/shared/useDrawingScope';

const DocumentViewer = dynamic(
  () => import('@bimdossier/viewer').then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Props = { projectId: string };

/**
 * Persona-A surface: a PDF-only project's drawings browsed by project Level, with
 * no 3D model. A Level dropdown picks the floor; a drawing dropdown picks the
 * discipline drawing on it (when several); the head version renders in a
 * `DocumentViewer`. The Level is the spine — exactly as in the modelled Split
 * view — so a project with no IFC still gets by-floor navigation.
 */
export function LevelDrawingPane({ projectId }: Props): ReactElement {
  const t = useTranslations('viewer.drawings');
  const tb = useTranslations('viewer.toolbar');
  const locale = useLocale();
  const compassLocale = locale === 'nl' ? 'nl' : 'en';

  const { levels, drawingsByLevel, hasDrawings, isLoading } = useDrawingScope(projectId);

  // Level options = every Level that holds ≥1 drawing, plus an "Unassigned"
  // bucket when untagged drawings exist (so nothing is unreachable).
  const levelOptions = useMemo(() => {
    const opts: Array<{ key: string; label: string }> = [];
    for (const lv of levels) {
      if ((drawingsByLevel.get(lv.id)?.length ?? 0) > 0) opts.push({ key: lv.id, label: lv.name });
    }
    if ((drawingsByLevel.get(UNASSIGNED_LEVEL)?.length ?? 0) > 0) {
      opts.push({ key: UNASSIGNED_LEVEL, label: t('unassigned') });
    }
    return opts;
  }, [levels, drawingsByLevel, t]);

  const [activeLevelKey, setActiveLevelKey] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [handle, setHandle] = useState<DocumentViewerHandle | null>(null);

  // Default / re-default the active level when the options change.
  useEffect(() => {
    if (levelOptions.length === 0) {
      if (activeLevelKey !== null) setActiveLevelKey(null);
      return;
    }
    const stillValid = activeLevelKey !== null && levelOptions.some((o) => o.key === activeLevelKey);
    if (!stillValid) setActiveLevelKey(levelOptions[0]!.key);
  }, [levelOptions, activeLevelKey]);

  const drawingsHere = useMemo(
    () => (activeLevelKey ? (drawingsByLevel.get(activeLevelKey) ?? []) : []),
    [activeLevelKey, drawingsByLevel],
  );

  // Default / re-default the active drawing within the level.
  useEffect(() => {
    if (drawingsHere.length === 0) {
      if (activeDocId !== null) setActiveDocId(null);
      return;
    }
    const stillValid = activeDocId !== null && drawingsHere.some((d) => d.id === activeDocId);
    if (!stillValid) setActiveDocId(drawingsHere[0]!.id);
  }, [drawingsHere, activeDocId]);

  const activeDoc = useMemo(
    () => drawingsHere.find((d) => d.id === activeDocId) ?? null,
    [drawingsHere, activeDocId],
  );
  const activeFileId = activeDoc ? headFileId(activeDoc) : null;

  // Reset paging when the rendered file changes.
  useEffect(() => {
    setCurrentPage(1);
    setNumPages(null);
  }, [activeDocId, activeFileId]);

  const bundleQuery = useViewerBundle(projectId, activeDocId ?? '', activeFileId ?? '');
  const fileUrl = bundleQuery.data?.file_url ?? null;

  const tDisc = useTranslations('viewer.floorplan.discipline');
  const disciplineLabel = useCallback(
    (d: string): string => {
      switch (d) {
        case 'architectural': return tDisc('architectural');
        case 'structural': return tDisc('structural');
        case 'mep': return tDisc('mep');
        case 'coordination': return tDisc('coordination');
        default: return tDisc('other');
      }
    },
    [tDisc],
  );
  const drawingLabel = useCallback(
    (d: { name: string; discipline: string }): string => `${disciplineLabel(d.discipline)} · ${d.name}`,
    [disciplineLabel],
  );

  if (isLoading) return <Skeleton className="absolute inset-0" />;
  if (!hasDrawings || levelOptions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body2 font-semibold text-foreground">{t('empty')}</p>
        <p className="max-w-sm text-body3 text-foreground-secondary">{t('emptyHint')}</p>
      </div>
    );
  }

  const activeLevelLabel = levelOptions.find((o) => o.key === activeLevelKey)?.label ?? '';

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-low">
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <ToolbarGroup className="gap-0.5">
          <StackIcon className="mx-1 h-3.5 w-3.5 text-foreground-tertiary" aria-hidden />
          {/* Level picker */}
          {levelOptions.length > 1 ? (
            <Picker label={activeLevelLabel} title={t('levelLabel')}>
              {levelOptions.map((o) => (
                <DropdownMenuItem key={o.key} onSelect={() => { setActiveLevelKey(o.key); }}>
                  {o.label}
                </DropdownMenuItem>
              ))}
            </Picker>
          ) : (
            <span className="max-w-[160px] truncate px-2 text-caption text-foreground-secondary">
              {activeLevelLabel}
            </span>
          )}
          {/* Drawing picker (only when the level holds several) */}
          {drawingsHere.length > 1 && (
            <>
              <ToolbarDivider />
              <Picker label={activeDoc ? drawingLabel(activeDoc) : ''} title={t('drawingLabel')}>
                {drawingsHere.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => { setActiveDocId(d.id); }}>
                    {drawingLabel(d)}
                  </DropdownMenuItem>
                ))}
              </Picker>
            </>
          )}
          <ToolbarDivider />
          {/* Page nav */}
          <ToolButton
            onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)); }}
            disabled={currentPage <= 1}
            aria-label={tb('prevPage')}
            title={tb('prevPage')}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </ToolButton>
          <span className="min-w-[3.5rem] px-1 text-center text-caption tabular-nums text-foreground-secondary">
            {currentPage}{numPages !== null ? ` / ${numPages}` : ''}
          </span>
          <ToolButton
            onClick={() => { setCurrentPage((p) => (numPages !== null ? Math.min(numPages, p + 1) : p + 1)); }}
            disabled={numPages !== null && currentPage >= numPages}
            aria-label={tb('nextPage')}
            title={tb('nextPage')}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </ToolButton>
          <ToolbarDivider />
          <ToolButton
            onClick={() => { handle?.fitPage(); }}
            disabled={handle === null}
            aria-label={tb('homeView')}
            title={tb('homeView')}
            className="h-8 w-8"
          >
            <House className="h-4 w-4" />
          </ToolButton>
        </ToolbarGroup>
      </div>

      {fileUrl !== null ? (
        <DocumentViewer
          key={`${activeDocId ?? ''}:${activeFileId ?? ''}`}
          ref={setHandle}
          fileUrl={fileUrl}
          currentPage={currentPage}
          activeTool="select"
          navCompass={{ locale: compassLocale }}
          className="absolute inset-0"
          onLoaded={({ numPages: n }) => { setNumPages(n); }}
        />
      ) : (
        <Skeleton className="absolute inset-0" />
      )}
    </div>
  );
}

/** Compact dropdown trigger matching the floor-plan / calibration pickers. */
function Picker({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={title}
          className="inline-flex h-8 max-w-[200px] items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground/80 hover:bg-foreground/[0.06] focus-visible:outline-none"
        >
          <span className="truncate">{label}</span>
          <CaretDownIcon className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="max-h-60 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
