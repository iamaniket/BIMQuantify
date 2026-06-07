'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { useFileCertificates } from '@/features/certificates/useCertificates';
import { useFileFindings } from '@/features/findings/useFindings';
import type { Certificate, Finding } from '@/lib/api/schemas';

import {
  useModelCertificateMarkers,
  useModelFindingMarkers,
} from '../shared/useEntityMarkers';

export function useEntityMarkers3D(
  handle: ViewerHandle | null,
  projectId: string,
  fileId: string | null,
  viewerReady: boolean,
): {
  clickedFinding: Finding | null;
  clickedCertificate: Certificate | null;
  clearClicked: () => void;
} {
  const findingMarkers = useModelFindingMarkers(projectId, fileId);
  const certMarkers = useModelCertificateMarkers(projectId, fileId);

  const allMarkers = useMemo(
    () => [...findingMarkers, ...certMarkers],
    [findingMarkers, certMarkers],
  );

  useEffect(() => {
    if (!handle || !viewerReady) return;
    handle.commands.execute('entity-marker.sync', allMarkers).catch(() => undefined);
  }, [handle, viewerReady, allMarkers]);

  const [clickedFinding, setClickedFinding] = useState<Finding | null>(null);
  const [clickedCertificate, setClickedCertificate] = useState<Certificate | null>(null);

  const { data: findings } = useFileFindings(projectId, fileId);
  const { data: certificates } = useFileCertificates(projectId, fileId);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findings?.find((x) => x.id === ev.entityId) ?? null;
        if (f) setClickedFinding(f);
      } else {
        const c = certificates?.find((x) => x.id === ev.entityId) ?? null;
        if (c) setClickedCertificate(c);
      }
    });
  }, [handle, findings, certificates]);

  const clearClicked = (): void => {
    setClickedFinding(null);
    setClickedCertificate(null);
  };

  return { clickedFinding, clickedCertificate, clearClicked };
}
