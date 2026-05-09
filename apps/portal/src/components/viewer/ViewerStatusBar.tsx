'use client';

import type { JSX } from 'react';

import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerFPS } from '@/features/viewer/useViewerFPS';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import type { ViewerMode } from './ViewerSideRail';

type ViewerStatusBarProps = {
  mode: ViewerMode;
  metadata?: ModelMetadata | undefined;
  viewerReady?: boolean;
  currentPage?: number;
  numPages?: number | null;
};

function Separator(): JSX.Element {
  return <span className="mx-2 inline-block h-[11px] w-px bg-foreground/10" />;
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-caption font-bold uppercase tracking-widest text-foreground/40">
      {children}
    </span>
  );
}

function Value({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-caption font-semibold tabular-nums tracking-tight text-foreground/80">
      {children}
    </span>
  );
}

function PdfStatusBar({
  currentPage,
  numPages,
}: {
  currentPage: number;
  numPages: number | null;
}): JSX.Element {
  return (
    <div className="flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border bg-background/95 px-3 font-mono backdrop-blur-sm">
      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        <Label>page</Label>
        <span>&nbsp;</span>
        <Value>
          {currentPage}
          {numPages !== null ? ` / ${numPages}` : ''}
        </Value>
        <Separator />
        <Label>view</Label>
        <span>&nbsp;</span>
        <Value>document</Value>
      </span>
      <span className="flex shrink-0 items-center">
        <Label>format</Label>
        <span>&nbsp;</span>
        <Value>PDF</Value>
      </span>
    </div>
  );
}

function IfcStatusBar({
  metadata,
  viewerReady,
}: {
  metadata: ModelMetadata | undefined;
  viewerReady: boolean;
}): JSX.Element {
  const fps = useViewerFPS(viewerReady);
  const selectionCount = useViewerEntityStore((s) => s.selected.size);
  const hiddenCount = useViewerEntityStore((s) => s.hidden.size);

  const totalElements = metadata?.totalElements ?? 0;
  const visibleCount = totalElements - hiddenCount;

  return (
    <div className="flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border bg-background/95 px-3 font-mono backdrop-blur-sm">
      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        <Label>selected</Label>
        <span>&nbsp;</span>
        <Value>{selectionCount > 0 ? selectionCount : '—'}</Value>
        <Separator />
        <Label>units</Label>
        <span>&nbsp;</span>
        <Value>{metadata?.project.lengthUnit ?? 'm'}</Value>
        <Separator />
        <Label>view</Label>
        <span>&nbsp;</span>
        <Value>perspective</Value>
      </span>
      <span className="flex shrink-0 items-center">
        <Label>elements</Label>
        <span>&nbsp;</span>
        <Value>{totalElements.toLocaleString()}</Value>
        <Separator />
        <Label>visible</Label>
        <span>&nbsp;</span>
        <Value>{visibleCount.toLocaleString()}</Value>
        <Separator />
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        <Label>fps</Label>
        <span>&nbsp;</span>
        <span className="text-caption font-semibold tabular-nums tracking-tight text-green-600 dark:text-green-400">
          {fps > 0 ? fps : '—'}
        </span>
        <Separator />
        <Label>gpu</Label>
        <span>&nbsp;</span>
        <Value>WebGL2</Value>
      </span>
    </div>
  );
}

export function ViewerStatusBar({
  mode,
  metadata,
  viewerReady = false,
  currentPage = 1,
  numPages = null,
}: ViewerStatusBarProps): JSX.Element {
  if (mode === 'pdf') {
    return <PdfStatusBar currentPage={currentPage} numPages={numPages} />;
  }
  return <IfcStatusBar metadata={metadata} viewerReady={viewerReady} />;
}
