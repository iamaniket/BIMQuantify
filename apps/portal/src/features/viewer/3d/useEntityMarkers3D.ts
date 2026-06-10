'use client';

import { useEffect, useState } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { useFileFindings } from '@/features/findings/useFindings';
import type { Finding } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import { useModelFindingMarkers } from '../shared/useEntityMarkers';

export function useEntityMarkers3D(
  handle: ViewerHandle | null,
  projectId: string,
  fileId: string | null,
  viewerReady: boolean,
): {
  clickedFinding: Finding | null;
  clearClicked: () => void;
} {
  const findingMarkers = useModelFindingMarkers(projectId, fileId);

  useEffect(() => {
    if (!handle || !viewerReady) return;
    handle.commands.execute('entity-marker.sync', findingMarkers).catch((err: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[EntityMarkers3D] sync failed:', err);
      }
    });
  }, [handle, viewerReady, findingMarkers]);

  const [clickedFinding, setClickedFinding] = useState<Finding | null>(null);

  const findingsQuery = useFileFindings(projectId, fileId);
  const findings = flattenPages(findingsQuery.data);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findings.find((x) => x.id === ev.entityId) ?? null;
        if (f) setClickedFinding(f);
      }
    });
    // `viewerReady` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, viewerReady, findings]);

  const clearClicked = (): void => {
    setClickedFinding(null);
  };

  return { clickedFinding, clearClicked };
}
