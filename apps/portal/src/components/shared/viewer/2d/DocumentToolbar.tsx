'use client';

import {
  ChevronLeft,
  ChevronRight,
  House,
  MousePointer2,
  Move,
  Search as SearchIcon,
  Settings,
  X as XIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from 'react';

import type {
  DocumentActiveTool,
  DocumentSearchHit,
  DocumentViewerHandle,
  SearchHighlight,
} from '@bimstitch/viewer';

import type { DocumentSettings } from '@/lib/documentSettings';

import { ToolButton, ToolbarReadout } from '@/components/shared/viewer/shared/_toolbarPrimitives';
import { type ToolGroup, UnifiedToolbar } from '@/components/shared/viewer/shared/UnifiedToolbar';
import { SettingsDialog } from '@/components/shared/viewer/shared/settings/SettingsDialog';

type Props = {
  currentPage: number;
  numPages: number | null;
  scale: number;
  activeTool: DocumentActiveTool;
  documentHandle: DocumentViewerHandle | null;
  settings: DocumentSettings;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onActiveToolChange: (tool: DocumentActiveTool) => void;
  onSettingsChange: (next: DocumentSettings) => void;
  onSearchHighlightChange: (highlight: SearchHighlight | null) => void;
};

function globalToLocal(
  globalIdx: number,
  hits: DocumentSearchHit[],
): { pageIndex: number; localIndex: number } | null {
  let cumulative = 0;
  for (const hit of hits) {
    if (cumulative + hit.matchesOnPage > globalIdx) {
      return { pageIndex: hit.pageIndex, localIndex: globalIdx - cumulative };
    }
    cumulative += hit.matchesOnPage;
  }
  return null;
}

function clampPage(value: number, max: number | null): number {
  if (max === null) return Math.max(1, value);
  return Math.min(Math.max(1, value), max);
}

export function DocumentToolbar({
  currentPage,
  numPages,
  scale,
  activeTool,
  documentHandle,
  settings,
  onPageChange,
  onScaleChange,
  onActiveToolChange,
  onSettingsChange,
  onSearchHighlightChange,
}: Props): JSX.Element {
  const t = useTranslations('documentToolbar');
  const tb = useTranslations('viewer.toolbar');
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<DocumentSearchHit[]>([]);
  const [globalMatchIndex, setGlobalMatchIndex] = useState(0);
  const [searchPending, setSearchPending] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setSearchHits([]);
    setGlobalMatchIndex(0);
    setSearchPerformed(false);
    onSearchHighlightChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentHandle]);

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      if (documentHandle === null) return;
      if (query.trim().length === 0) {
        setSearchHits([]);
        setGlobalMatchIndex(0);
        setSearchPerformed(false);
        onSearchHighlightChange(null);
        return;
      }
      setSearchPending(true);
      try {
        const hits = await documentHandle.searchText(query);
        setSearchHits(hits);
        setGlobalMatchIndex(0);
        setSearchPerformed(true);
        const first = hits[0];
        if (first !== undefined) {
          onPageChange(first.pageIndex);
          onSearchHighlightChange({ query, activeMatchIndex: 0 });
        } else {
          onSearchHighlightChange(null);
        }
      } finally {
        setSearchPending(false);
      }
    },
    [documentHandle, onPageChange, onSearchHighlightChange],
  );

  const totalMatches = searchHits.reduce((sum, h) => sum + h.matchesOnPage, 0);

  const stepSearch = useCallback(
    (delta: 1 | -1): void => {
      if (totalMatches === 0) return;
      const nextGlobal = (globalMatchIndex + delta + totalMatches) % totalMatches;
      setGlobalMatchIndex(nextGlobal);
      const loc = globalToLocal(nextGlobal, searchHits);
      if (loc !== null) {
        onPageChange(loc.pageIndex);
        onSearchHighlightChange({ query: searchQuery, activeMatchIndex: loc.localIndex });
      }
    },
    [totalMatches, globalMatchIndex, searchHits, searchQuery, onPageChange, onSearchHighlightChange],
  );

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(clampPage(parsed, numPages));
    } else {
      setPageInput(String(currentPage));
    }
  };

  const canPrev = currentPage > 1;
  const canNext = numPages === null ? false : currentPage < numPages;

  const groups: ToolGroup[] = [
    {
      tools: [
        {
          type: 'button', id: 'home-fit-page', icon: House, label: tb('fitPage'),
          tooltip: tb('fitPage'),
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.fitPage(); },
        },
        {
          type: 'button', id: 'select', icon: MousePointer2, label: tb('select'),
          isActive: activeTool === 'select',
          onClick: () => { onActiveToolChange('select'); },
        },
        {
          type: 'button', id: 'pan', icon: Move, label: tb('pan'),
          tooltip: tb('panTooltip'),
          isActive: activeTool === 'pan',
          onClick: () => { onActiveToolChange('pan'); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'prev-page', icon: ChevronLeft, label: tb('prevPage'),
          disabled: !canPrev,
          onClick: () => { onPageChange(clampPage(currentPage - 1, numPages)); },
        },
        {
          type: 'node',
          id: 'page-input',
          node: (
            <form onSubmit={handlePageSubmit} className="flex items-center gap-1 px-1">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => { setPageInput(e.target.value); }}
                onBlur={() => {
                  const parsed = Number.parseInt(pageInput, 10);
                  if (Number.isFinite(parsed)) {
                    onPageChange(clampPage(parsed, numPages));
                  } else {
                    setPageInput(String(currentPage));
                  }
                }}
                aria-label={tb('currentPage')}
                className="h-9 w-10 rounded-md border border-border bg-background px-1 text-center text-xs font-semibold tabular-nums text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <span className="text-caption font-medium text-foreground/55">
                / {numPages ?? '—'}
              </span>
            </form>
          ),
        },
        {
          type: 'button', id: 'next-page', icon: ChevronRight, label: tb('nextPage'),
          disabled: !canNext,
          onClick: () => { onPageChange(clampPage(currentPage + 1, numPages)); },
        },
      ],
    },
    {
      tools: [
        searchOpen
          ? {
              type: 'node',
              id: 'search',
              node: (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(searchQuery);
                  }}
                  className="flex items-center gap-1 px-1"
                  role="search"
                >
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); }}
                    placeholder={t('searchPlaceholder')}
                    aria-label={t('searchLabel')}
                    autoFocus
                    data-testid="document-search-input"
                    className="h-9 w-40 rounded-md border border-border bg-background px-2 text-xs text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                  <ToolbarReadout className="min-w-[64px]">
                    {searchPending
                      ? t('searchRunning')
                      : searchPerformed
                        ? totalMatches === 0
                          ? t('searchEmpty')
                          : t('searchMatchCount', { current: globalMatchIndex + 1, total: totalMatches })
                        : ''}
                  </ToolbarReadout>
                  <ToolButton
                    type="button"
                    onClick={() => { stepSearch(-1); }}
                    disabled={totalMatches === 0}
                    title={t('searchPrev')}
                    aria-label={t('searchPrev')}
                    data-testid="document-search-prev"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                  </ToolButton>
                  <ToolButton
                    type="button"
                    onClick={() => { stepSearch(1); }}
                    disabled={totalMatches === 0}
                    title={t('searchNext')}
                    aria-label={t('searchNext')}
                    data-testid="document-search-next"
                  >
                    <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
                  </ToolButton>
                  <ToolButton
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery('');
                      setSearchHits([]);
                      setGlobalMatchIndex(0);
                      setSearchPerformed(false);
                      onSearchHighlightChange(null);
                    }}
                    title={t('searchClose')}
                    aria-label={t('searchClose')}
                    data-testid="document-search-close"
                  >
                    <XIcon className="h-5 w-5" strokeWidth={1.75} />
                  </ToolButton>
                </form>
              ),
            }
          : {
              type: 'button',
              id: 'search',
              icon: SearchIcon,
              label: t('searchLabel'),
              disabled: documentHandle === null,
              onClick: () => { setSearchOpen(true); },
            },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'settings', icon: Settings, label: tb('settings'),
          isActive: settingsOpen,
          onClick: () => { setSettingsOpen((v) => !v); },
        },
      ],
    },
  ];

  return (
    <UnifiedToolbar groups={groups} testId="document-toolbar" testIdPrefix="document">
      <SettingsDialog
        mode="2d"
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); }}
        handle={undefined}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onReloadViewer={undefined}
      />
    </UnifiedToolbar>
  );
}
