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
};

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
}: Props): JSX.Element {
  const t = useTranslations('documentToolbar');
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<DocumentSearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchPending, setSearchPending] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setSearchHits([]);
    setSearchIndex(0);
    setSearchPerformed(false);
  }, [documentHandle]);

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      if (documentHandle === null) return;
      if (query.trim().length === 0) {
        setSearchHits([]);
        setSearchIndex(0);
        setSearchPerformed(false);
        return;
      }
      setSearchPending(true);
      try {
        const hits = await documentHandle.searchText(query);
        setSearchHits(hits);
        setSearchIndex(0);
        setSearchPerformed(true);
        const first = hits[0];
        if (first !== undefined) onPageChange(first.pageIndex);
      } finally {
        setSearchPending(false);
      }
    },
    [documentHandle, onPageChange],
  );

  const stepSearch = useCallback(
    (delta: 1 | -1): void => {
      if (searchHits.length === 0) return;
      const next = (searchIndex + delta + searchHits.length) % searchHits.length;
      setSearchIndex(next);
      const hit = searchHits[next];
      if (hit !== undefined) onPageChange(hit.pageIndex);
    },
    [searchHits, searchIndex, onPageChange],
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

  const totalMatches = searchHits.reduce((sum, h) => sum + h.matchesOnPage, 0);
  const canPrev = currentPage > 1;
  const canNext = numPages === null ? false : currentPage < numPages;
  const ThemeIcon = isDark ? Moon : Sun;

  const groups: ToolGroup[] = [
    {
      tools: [
        {
          type: 'button', id: 'select', icon: MousePointer2, label: 'Select',
          isActive: activeTool === 'select',
          onClick: () => { onActiveToolChange('select'); },
        },
        {
          type: 'button', id: 'pan', icon: Move, label: 'Pan',
          tooltip: 'Pan (drag to move)',
          isActive: activeTool === 'pan',
          onClick: () => { onActiveToolChange('pan'); },
        },
        {
          type: 'button', id: 'zoom', icon: ZoomIn, label: 'Zoom',
          tooltip: 'Zoom (click to zoom in, Alt+click to zoom out)',
          isActive: activeTool === 'zoom',
          onClick: () => { onActiveToolChange('zoom'); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'fit-page', icon: Maximize, label: 'Fit to page',
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.fitPage(); },
        },
        {
          type: 'button', id: 'fit-width', icon: Monitor, label: 'Fit to width',
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
              title="Actual size (100%)"
              aria-label="Actual size"
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
          type: 'button', id: 'rotate-left', icon: RotateCcw, label: 'Rotate left',
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.rotateBy(-90); },
        },
        {
          type: 'button', id: 'rotate-right', icon: RotateCw, label: 'Rotate right',
          disabled: documentHandle === null,
          onClick: () => { documentHandle?.rotateBy(90); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'zoom-out', icon: Minus, label: 'Zoom out',
          disabled: scale <= MIN_SCALE,
          onClick: () => { onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP)); },
        },
        {
          type: 'node',
          id: 'zoom-readout',
          node: <ToolbarReadout>{Math.round(scale * 100)}%</ToolbarReadout>,
        },
        {
          type: 'button', id: 'zoom-in', icon: Plus, label: 'Zoom in',
          disabled: scale >= MAX_SCALE,
          onClick: () => { onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP)); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'prev-page', icon: ChevronLeft, label: 'Previous page',
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
                aria-label="Current page"
                className="h-12 w-12 rounded-md border border-border bg-background px-1.5 text-center text-[14px] font-semibold tabular-nums text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <span className="text-caption font-medium text-foreground/55">
                / {numPages ?? '—'}
              </span>
            </form>
          ),
        },
        {
          type: 'button', id: 'next-page', icon: ChevronRight, label: 'Next page',
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
                    className="h-12 w-44 rounded-md border border-border bg-background px-2 text-[14px] text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                  <ToolbarReadout className="min-w-[64px]">
                    {searchPending
                      ? t('searchRunning')
                      : searchPerformed
                        ? searchHits.length === 0
                          ? t('searchEmpty')
                          : totalMatches === 1 && searchHits.length === 1
                            ? t('searchMatchCountOne')
                            : t('searchMatchCount', { matches: totalMatches, pages: searchHits.length })
                        : ''}
                  </ToolbarReadout>
                  <ToolButton
                    type="button"
                    onClick={() => { stepSearch(-1); }}
                    disabled={searchHits.length === 0}
                    title={t('searchPrev')}
                    aria-label={t('searchPrev')}
                    data-testid="document-search-prev"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                  </ToolButton>
                  <ToolButton
                    type="button"
                    onClick={() => { stepSearch(1); }}
                    disabled={searchHits.length === 0}
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
                      setSearchIndex(0);
                      setSearchPerformed(false);
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
          type: 'button', id: 'settings', icon: Settings, label: 'Settings',
          isActive: settingsOpen,
          onClick: () => { setSettingsOpen((v) => !v); },
        },
        {
          type: 'button', id: 'theme', icon: ThemeIcon, label: 'Toggle theme',
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
