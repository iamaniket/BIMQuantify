'use client';

import type { JSX } from 'react';

import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useViewerFPS } from '@/hooks/useViewerFPS';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

type ViewerStatusBarProps = {
  metadata: ModelMetadata | undefined;
  viewerReady: boolean;
};

function Separator(): JSX.Element {
  return <span className="mx-2 inline-block h-[11px] w-px bg-foreground/10" />;
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-[8.5px] font-bold uppercase tracking-widest text-foreground/40">
      {children}
    </span>
  );
}

function Value({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-[10px] font-semibold tabular-nums tracking-tight text-foreground/80">
      {children}
    </span>
  );
}

export function ViewerStatusBar({ metadata, viewerReady }: ViewerStatusBarProps): JSX.Element {
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
        <span className="text-[10px] font-semibold tabular-nums tracking-tight text-green-600 dark:text-green-400">
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
