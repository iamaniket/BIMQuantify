'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { DocumentViewerHandle } from '@bimdossier/viewer';

import { useFileFindings } from '@/features/findings/useFindings';
import type { Finding } from '@/lib/api/schemas';
import { useFlattenedPages } from '@/lib/query/useAuthInfiniteQuery';

import { usePageFindingMarkers } from '../shared/useEntityMarkers';

interface EntityMarkers2DOptions {
  projectId: string;
  fileId: string | null;
  /** 1-based current PDF page, or null when not a PDF. */
  page: number | null;
  /** Only sync/subscribe while a PDF document viewer is mounted. */
  enabled: boolean;
  onFindingClick: (finding: Finding) => void;
}

/**
 * 2D counterpart to {@link useEntityMarkers3D}: feeds finding markers (with PDF
 * anchors on the current page) to the `entity-marker-2d` plugin, which renders
 * them as three.js glyphs in the shared scene. Clicks come back through the
 * document handle's event bus; this hook resolves them to findings and forwards
 * to the page's handler.
 */
export function useEntityMarkers2D(
  handle: DocumentViewerHandle | null,
  opts: EntityMarkers2DOptions,
): void {
  const { projectId, fileId, page, enabled } = opts;
  const scopedFileId = enabled ? fileId : null;
  const scopedPage = enabled ? page : null;

  const findingMarkers = usePageFindingMarkers(projectId, scopedFileId, scopedPage);

  useEffect(() => {
    if (!handle || !enabled) return;
    handle.commands.execute('entity-marker-2d.sync', findingMarkers).catch(() => undefined);
  }, [handle, enabled, findingMarkers]);

  // Lookup map so click resolution is O(1) rather than a linear scan per click.
  const findings = useFlattenedPages(useFileFindings(projectId, scopedFileId).data);
  const findingMap = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  // Keep callbacks in a ref so subscriptions don't churn when handlers change.
  const cbRef = useRef(opts);
  cbRef.current = opts;

  useEffect(() => {
    if (!handle || !enabled) return undefined;
    const offClick = handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findingMap.get(ev.entityId);
        if (f) cbRef.current.onFindingClick(f);
      }
    });
    return () => {
      offClick();
    };
  }, [handle, enabled, findingMap]);
}
