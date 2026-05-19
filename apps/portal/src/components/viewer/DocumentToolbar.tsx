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

import {
  ToolButton,
  ToolbarGroup,
  ToolbarReadout,
  ToolbarShell,
} from './_toolbarPrimitives';
import { DocumentSettingsPopover } from './DocumentSettingsPopover';

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

  // If the file changes (handle replaced) wipe the search state.
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
        if (hits.length > 0) {
          const first = hits[0];
          if (first !== undefined) onPageChange(first.pageIndex);
        }
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

  const totalMatches = searchHits.reduce((sum, h) => sum + h.matchesOnPage, 0);

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

  return (
    <ToolbarShell testId="document-toolbar">
      {settingsOpen ? (
        <DocumentSettingsPopover
          settings={settings}
          onSettingsChange={onSettingsChange}
          onClose={() => { setSettingsOpen(false); }}
        />
      ) : null}

      {/* Group 1: Navigation tools (Select / Pan / Zoom) */}
      <ToolbarGroup withDivider={false}>
        <ToolButton
          isActive={activeTool === 'select'}
          onClick={() => { onActiveToolChange('select'); }}
          title="Select"
          aria-label="Select"
          data-testid="document-tool-select"
        >
          <MousePointer2 className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          isActive={activeTool === 'pan'}
          onClick={() => { onActiveToolChange('pan'); }}
          title="Pan (drag to move)"
          aria-label="Pan"
          data-testid="document-tool-pan"
        >
          <Move className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          isActive={activeTool === 'zoom'}
          onClick={() => { onActiveToolChange('zoom'); }}
          title="Zoom (click to zoom in, Alt+click to zoom out)"
          aria-label="Zoom"
          data-testid="document-tool-zoom"
        >
          <ZoomIn className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </ToolbarGroup>

      {/* Group 2: Fit controls */}
      <ToolbarGroup>
        <ToolButton
          onClick={() => documentHandle?.fitPage()}
          disabled={documentHandle === null}
          title="Fit to page"
          aria-label="Fit to page"
          data-testid="document-tool-fit-page"
        >
          <Maximize className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          onClick={() => documentHandle?.fitWidth()}
          disabled={documentHandle === null}
          title="Fit to width"
          aria-label="Fit to width"
          data-testid="document-tool-fit-width"
        >
          <Monitor className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          onClick={() => documentHandle?.actualSize()}
          disabled={documentHandle === null}
          title="Actual size (100%)"
          aria-label="Actual size"
          data-testid="document-tool-actual-size"
        >
          <span className="text-caption font-bold">1:1</span>
        </ToolButton>
      </ToolbarGroup>

      {/* Group 3: Rotation */}
      <ToolbarGroup>
        <ToolButton
          onClick={() => documentHandle?.rotateBy(-90)}
          disabled={documentHandle === null}
          title="Rotate left"
          aria-label="Rotate left"
          data-testid="document-tool-rotate-left"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          onClick={() => documentHandle?.rotateBy(90)}
          disabled={documentHandle === null}
          title="Rotate right"
          aria-label="Rotate right"
          data-testid="document-tool-rotate-right"
        >
          <RotateCw className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </ToolbarGroup>

      {/* Group 4: Zoom step controls + percentage readout */}
      <ToolbarGroup>
        <ToolButton
          onClick={() => { onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP)); }}
          disabled={scale <= MIN_SCALE}
          title="Zoom out"
          aria-label="Zoom out"
          data-testid="document-tool-zoom-out"
        >
          <Minus className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolbarReadout>{Math.round(scale * 100)}%</ToolbarReadout>
        <ToolButton
          onClick={() => { onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP)); }}
          disabled={scale >= MAX_SCALE}
          title="Zoom in"
          aria-label="Zoom in"
          data-testid="document-tool-zoom-in"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </ToolbarGroup>

      {/* Group 5: Page navigation */}
      <ToolbarGroup>
        <ToolButton
          onClick={() => { onPageChange(clampPage(currentPage - 1, numPages)); }}
          disabled={!canPrev}
          title="Previous page"
          aria-label="Previous page"
          data-testid="document-tool-prev-page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
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
            className="h-7 w-10 rounded-md border border-border bg-background px-1.5 text-center text-caption font-semibold tabular-nums text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <span className="text-caption font-medium text-foreground/55">
            / {numPages ?? '—'}
          </span>
        </form>
        <ToolButton
          onClick={() => { onPageChange(clampPage(currentPage + 1, numPages)); }}
          disabled={!canNext}
          title="Next page"
          aria-label="Next page"
          data-testid="document-tool-next-page"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </ToolbarGroup>

      {/* Group 5b: Search */}
      <ToolbarGroup>
        {searchOpen ? (
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
              className="h-7 w-44 rounded-md border border-border bg-background px-2 text-caption text-foreground/90 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            <ToolbarReadout className="min-w-[64px]">
              {searchPending
                ? t('searchRunning')
                : searchPerformed
                  ? searchHits.length === 0
                    ? t('searchEmpty')
                    : totalMatches === 1 && searchHits.length === 1
                      ? t('searchMatchCountOne')
                      : t('searchMatchCount', {
                          matches: totalMatches,
                          pages: searchHits.length,
                        })
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
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </ToolButton>
            <ToolButton
              type="button"
              onClick={() => { stepSearch(1); }}
              disabled={searchHits.length === 0}
              title={t('searchNext')}
              aria-label={t('searchNext')}
              data-testid="document-search-next"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
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
              <XIcon className="h-4 w-4" strokeWidth={1.75} />
            </ToolButton>
          </form>
        ) : (
          <ToolButton
            onClick={() => { setSearchOpen(true); }}
            disabled={documentHandle === null}
            title={t('searchLabel')}
            aria-label={t('searchLabel')}
            data-testid="document-tool-search"
          >
            <SearchIcon className="h-4 w-4" strokeWidth={1.75} />
          </ToolButton>
        )}
      </ToolbarGroup>

      {/* Group 6: Settings + theme */}
      <ToolbarGroup>
        <ToolButton
          isActive={settingsOpen}
          onClick={() => { setSettingsOpen((v) => !v); }}
          title="Settings"
          aria-label="Settings"
          data-testid="document-tool-settings"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          onClick={() => { setTheme(isDark ? 'light' : 'dark'); }}
          title="Toggle theme"
          aria-label="Toggle theme"
          data-testid="document-tool-theme"
        >
          <ThemeIcon className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </ToolbarGroup>
    </ToolbarShell>
  );
}
