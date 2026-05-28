'use client';

import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerFPS } from '@/features/viewer/useViewerFPS';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import type { Mode } from '@/components/shared/viewer/SideRail';

type StatusBarProps = {
  mode: Mode;
  metadata?: ModelMetadata | undefined;
  viewerReady?: boolean;
  currentPage?: number;
  numPages?: number | null;
};

function Separator(): JSX.Element {
  return <span className="mx-1.5 inline-block h-[9px] w-px bg-white/20" />;
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-caption font-bold uppercase tracking-widest text-white/50">
      {children}
    </span>
  );
}

function Value({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-caption font-semibold tabular-nums tracking-tight text-white/90">
      {children}
    </span>
  );
}

function PdfStatusBar({
  currentPage,
  numPages,
  className,
}: {
  currentPage: number;
  numPages: number | null;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex h-[18px] shrink-0 items-center overflow-hidden px-2 font-mono', className)} style={{ background: 'linear-gradient(90deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)' }}>
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
  className,
}: {
  metadata: ModelMetadata | undefined;
  viewerReady: boolean;
  className?: string;
}): JSX.Element {
  const fps = useViewerFPS(viewerReady);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const partialCount = useViewerEntityStore((s) => s.selected.size);
  const hiddenCount = useViewerEntityStore((s) => s.hidden.size);

  const totalElements = metadata?.totalElements ?? 0;
  const visibleCount = totalElements - hiddenCount;
  const selectionCount = selectedAll ? totalElements : partialCount;

  const hasSelection = selectionCount > 0;

  return (
    <div className={cn('flex h-[18px] shrink-0 items-center overflow-hidden px-2 font-mono', className)} style={{ background: 'linear-gradient(90deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)' }}>
      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        {hasSelection ? (
          <span className="inline-flex items-center rounded-sm bg-white/15 px-1.5">
            <span className="text-caption font-bold uppercase tracking-widest text-amber-300">
              selected
            </span>
            <span>&nbsp;</span>
            <span className="text-caption font-bold tabular-nums tracking-tight text-amber-200">
              {selectionCount.toLocaleString()}
            </span>
          </span>
        ) : (
          <>
            <Label>selected</Label>
            <span>&nbsp;</span>
            <Value>—</Value>
          </>
        )}
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
        <span className="text-caption font-semibold tabular-nums tracking-tight text-green-300">
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

export function StatusBar({
  mode,
  metadata,
  viewerReady = false,
  currentPage = 1,
  numPages = null,
}: StatusBarProps): JSX.Element {
  if (mode === 'pdf') {
    return <PdfStatusBar currentPage={currentPage} numPages={numPages} />;
  }
  return <IfcStatusBar metadata={metadata} viewerReady={viewerReady} />;
}
