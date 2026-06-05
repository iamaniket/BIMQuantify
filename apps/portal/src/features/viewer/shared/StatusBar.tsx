'use client';

import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { DrawingMetadata } from '@/lib/api/schemas/geometry';
import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';
import { useFileAttachmentCount } from '@/features/attachments/useAttachments';
import { useFileFindingCount } from '@/features/findings/useFindings';
import { useViewerFPS } from '@/features/viewer/3d/useViewerFPS';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import type { Mode } from '@/components/shared/viewer/shared/SideRail';

type StatusBarProps = {
  mode: Mode;
  metadata?: ModelMetadata | undefined;
  drawingMetadata?: DrawingMetadata | undefined;
  viewerReady?: boolean;
  currentPage?: number;
  numPages?: number | null;
  projectId?: string;
  fileId?: string;
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
    <div className={cn('flex h-[18px] shrink-0 items-center overflow-hidden px-2 font-sans', className)} style={{ background: 'linear-gradient(90deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)' }}>
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

function DrawingStatusBar({
  metadata,
  className,
}: {
  metadata: DrawingMetadata | undefined;
  className?: string;
}): JSX.Element {
  const extents = metadata?.extents ?? null;
  const size = extents !== null
    ? `${(extents.max[0] - extents.min[0]).toFixed(1)} × ${(extents.max[1] - extents.min[1]).toFixed(1)}`
    : null;
  return (
    <div className={cn('flex h-[18px] shrink-0 items-center overflow-hidden px-2 font-sans', className)} style={{ background: 'linear-gradient(90deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)' }}>
      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        <Label>units</Label>
        <span>&nbsp;</span>
        <Value>{metadata?.units ?? '—'}</Value>
        <Separator />
        <Label>layers</Label>
        <span>&nbsp;</span>
        <Value>{metadata !== undefined ? metadata.layers.length : '—'}</Value>
        {size !== null ? (
          <>
            <Separator />
            <Label>extents</Label>
            <span>&nbsp;</span>
            <Value>{size}</Value>
          </>
        ) : null}
        <Separator />
        <Label>view</Label>
        <span>&nbsp;</span>
        <Value>drawing</Value>
      </span>
      <span className="flex shrink-0 items-center">
        <Label>format</Label>
        <span>&nbsp;</span>
        <Value>{metadata !== undefined ? metadata.source.toUpperCase() : 'DXF'}</Value>
      </span>
    </div>
  );
}

function countStoreys(node: SpatialNode | null): number {
  if (node === null) return 0;
  let count = node.type === 'IfcBuildingStorey' ? 1 : 0;
  for (const child of node.children) {
    count += countStoreys(child);
  }
  return count;
}

function formatDimensions(
  bbox: { min: [number, number, number]; max: [number, number, number] } | null,
  unit: string,
): string | null {
  if (bbox === null) return null;
  const w = Math.abs(bbox.max[0] - bbox.min[0]);
  const d = Math.abs(bbox.max[1] - bbox.min[1]);
  const h = Math.abs(bbox.max[2] - bbox.min[2]);
  return `${w.toFixed(1)}×${d.toFixed(1)}×${h.toFixed(1)} ${unit}`;
}

function IfcStatusBar({
  metadata,
  viewerReady,
  projectId,
  fileId,
  className,
}: {
  metadata: ModelMetadata | undefined;
  viewerReady: boolean;
  projectId: string | undefined;
  fileId: string | undefined;
  className?: string;
}): JSX.Element {
  const fps = useViewerFPS(viewerReady);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const partialCount = useViewerEntityStore((s) => s.selected.size);
  const hiddenCount = useViewerEntityStore((s) => s.hidden.size);
  const storeTotalElements = useViewerEntityStore((s) => s.totalElements);

  const attachmentCount = useFileAttachmentCount(projectId ?? '', fileId ?? null);
  const findingCount = useFileFindingCount(projectId ?? '', fileId ?? null);

  const totalElements = storeTotalElements > 0 ? storeTotalElements : (metadata?.totalElements ?? 0);
  const visibleCount = totalElements - hiddenCount;
  const selectionCount = selectedAll ? totalElements : partialCount;
  const hasSelection = selectionCount > 0;

  const storeys = countStoreys(metadata?.spatialTree ?? null);
  const dims = formatDimensions(metadata?.bbox ?? null, metadata?.project.lengthUnit ?? 'm');

  return (
    <div className={cn('flex h-[18px] shrink-0 items-center overflow-hidden px-2 font-sans', className)} style={{ background: 'linear-gradient(90deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)' }}>
      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        <Label>schema</Label>
        <span>&nbsp;</span>
        <Value>{metadata?.schema ?? '—'}</Value>
        <Separator />
        <Label>units</Label>
        <span>&nbsp;</span>
        <Value>{metadata?.project.lengthUnit ?? 'm'}</Value>
        <Separator />
        <Label>storeys</Label>
        <span>&nbsp;</span>
        <Value>{storeys > 0 ? storeys : '—'}</Value>
        {dims !== null ? (
          <>
            <Separator />
            <Label>dims</Label>
            <span>&nbsp;</span>
            <Value>{dims}</Value>
          </>
        ) : null}
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
        <Label>selected</Label>
        <span>&nbsp;</span>
        <Value>{selectionCount.toLocaleString()}</Value>
        <Separator />
        <Label>attach</Label>
        <span>&nbsp;</span>
        <Value>{attachmentCount.toLocaleString()}</Value>
        <Separator />
        <Label>findings</Label>
        <span>&nbsp;</span>
        <Value>{findingCount.toLocaleString()}</Value>
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
  drawingMetadata,
  viewerReady = false,
  currentPage = 1,
  numPages = null,
  projectId,
  fileId,
}: StatusBarProps): JSX.Element {
  if (mode === 'pdf') {
    return <PdfStatusBar currentPage={currentPage} numPages={numPages} />;
  }
  if (mode === 'drawing') {
    return <DrawingStatusBar metadata={drawingMetadata} />;
  }
  return <IfcStatusBar metadata={metadata} viewerReady={viewerReady} projectId={projectId} fileId={fileId} />;
}
