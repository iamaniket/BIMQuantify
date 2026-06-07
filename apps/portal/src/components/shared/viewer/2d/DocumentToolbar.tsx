'use client';

import { ChevronLeft, ChevronRight, House, MousePointer2, Move, Settings } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from 'react';

import type {
  DocumentActiveTool,
  DocumentViewerHandle,
} from '@bimstitch/viewer';

import type { DocumentSettings } from '@/lib/documentSettings';

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
};

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
  const tb = useTranslations('viewer.toolbar');
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

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
                id="document-page-input"
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
