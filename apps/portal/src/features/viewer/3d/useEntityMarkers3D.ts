'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { useIfcFileAttachments } from '@/features/attachments/useAttachments';
import { useFileCertificates } from '@/features/certificates/useCertificates';
import { useFileFindings } from '@/features/findings/useFindings';
import type { Attachment, Certificate, Finding } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import {
  useModelAttachmentMarkers,
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
  clickedAttachment: Attachment | null;
  clearClicked: () => void;
} {
  const findingMarkers = useModelFindingMarkers(projectId, fileId);
  const certMarkers = useModelCertificateMarkers(projectId, fileId);
  const attachmentMarkers = useModelAttachmentMarkers(projectId, fileId);

  const allMarkers = useMemo(
    () => [...findingMarkers, ...certMarkers, ...attachmentMarkers],
    [findingMarkers, certMarkers, attachmentMarkers],
  );

  useEffect(() => {
    if (!handle || !viewerReady) return;
    handle.commands.execute('entity-marker.sync', allMarkers).catch((err: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[EntityMarkers3D] sync failed:', err);
      }
    });
  }, [handle, viewerReady, allMarkers]);

  const [clickedFinding, setClickedFinding] = useState<Finding | null>(null);
  const [clickedCertificate, setClickedCertificate] = useState<Certificate | null>(null);
  const [clickedAttachment, setClickedAttachment] = useState<Attachment | null>(null);

  const findingsQuery = useFileFindings(projectId, fileId);
  const certificatesQuery = useFileCertificates(projectId, fileId);
  const attachmentsQuery = useIfcFileAttachments(projectId, fileId);
  const findings = flattenPages(findingsQuery.data);
  const certificates = flattenPages(certificatesQuery.data);
  const attachments = flattenPages(attachmentsQuery.data);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findings.find((x) => x.id === ev.entityId) ?? null;
        if (f) setClickedFinding(f);
      } else if (ev.type === 'certificate') {
        const c = certificates.find((x) => x.id === ev.entityId) ?? null;
        if (c) setClickedCertificate(c);
      } else if (ev.type === 'attachment') {
        const a = attachments.find((x) => x.id === ev.entityId) ?? null;
        if (a) setClickedAttachment(a);
      }
    });
    // `viewerReady` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, viewerReady, findings, certificates, attachments]);

  const clearClicked = (): void => {
    setClickedFinding(null);
    setClickedCertificate(null);
    setClickedAttachment(null);
  };

  return { clickedFinding, clickedCertificate, clickedAttachment, clearClicked };
}
