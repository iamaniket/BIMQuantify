'use client';

import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  Move,
  PenLine,
  Plus,
  RotateCcw,
  RotateCw,
  Search as SearchIcon,
  Settings,
  Sun,
  X as XIcon,
  ZoomIn,
} from 'lucide-react';
import { useTheme } from 'next-themes';
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

import { ToolButton, ToolbarReadout } from './_toolbarPrimitives';
import { type ToolGroup, UnifiedToolbar } from './UnifiedToolbar';
import { SettingsDialog } from './settings/SettingsDialog';

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

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

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
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

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
  const ThemeIcon = isDark ? Moon : Sun;

  const groups: ToolGroup[] = [
    {
      tools: [
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
        {
          type: 'button', id: 'zoom', icon: ZoomIn, label: tb('zoom'),
          tooltip: tb('zoomTooltip'),
          isActive: activeTool === 'zoom',
          onClick: () => { onActiveToolChange('zoom'); },
        },
        {
          type: 'button', id: 'line', icon: PenLine, label: tb('line'),
          tooltip: tb('lineTooltip'),
          isActive: activeTool === 'line',
          onClick: () => { onActiveToolChange('line'); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'fit-page', icon: Maximize, label: tb('fitPage'),
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.fitPage(); },
        },
        {
          type: 'button', id: 'fit-width', icon: Monitor, label: tb('fitWidth'),
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.fitWidth(); },
        },
        {
          type: 'node',
          id: 'actual-size',
          node: (
            <ToolButton
              onClick={() => { documentHandle?.actualSize(); }}
              disabled={documentHandle === null}
              title={tb('actualSizeTooltip')}
              aria-label={tb('actualSize')}
              data-testid="document-tool-actual-size"
            >
              <span className="text-caption font-bold">1:1</span>
            </ToolButton>
          ),
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'rotate-left', icon: RotateCcw, label: tb('rotateLeft'),
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.rotateBy(-90); },
        },
        {
          type: 'button', id: 'rotate-right', icon: RotateCw, label: tb('rotateRight'),
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.rotateBy(90); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'zoom-out', icon: Minus, label: tb('zoomOut'),
          disabled: scale <= MIN_SCALE,
          onClick: () => { onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP)); },
        },
        {
          type: 'node',
          id: 'zoom-readout',
          node: <ToolbarReadout>{Math.round(scale * 100)}%</ToolbarReadout>,
        },
        {
          type: 'button', id: 'zoom-in', icon: Plus, label: tb('zoomIn'),
          disabled: scale >= MAX_SCALE,
          onClick: () => { onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP)); },
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
        {
          type: 'button', id: 'theme', icon: ThemeIcon, label: tb('toggleTheme'),
          onClick: () => { setTheme(isDark ? 'light' : 'dark'); },
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
