'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { DocumentViewerHandle } from '@bimstitch/viewer';

import { usePdfPageAttachments } from '@/features/attachments/useAttachments';
import { useFileCertificates } from '@/features/certificates/useCertificates';
import { useFileFindings } from '@/features/findings/useFindings';
import type { Attachment, Certificate, Finding } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import type { EntityMarker2D } from '../shared/entityMarkerTypes';
import { usePageCertificateMarkers, usePageFindingMarkers } from '../shared/useEntityMarkers';

interface EntityMarkers2DOptions {
  projectId: string;
  fileId: string | null;
  /** 1-based current PDF page, or null when not a PDF. */
  page: number | null;
  /** Only sync/subscribe while a PDF document viewer is mounted. */
  enabled: boolean;
  onFindingClick: (finding: Finding) => void;
  onCertificateClick: (certificate: Certificate) => void;
  onAttachmentClick: (attachment: Attachment) => void;
  /** A pin-placement click resolved to a normalized page point. */
  onPlace: (point: { x: number; y: number; page: number }) => void;
}

/**
 * 2D counterpart to {@link useEntityMarkers3D}: feeds finding / certificate /
 * attachment markers (with PDF anchors on the current page) to the
 * `entity-marker-2d` plugin, which renders them as three.js glyphs in the shared
 * scene. Click + placement events come back through the document handle's event
 * bus; this hook resolves them to entities and forwards to the page's handlers.
 */
export function useEntityMarkers2D(
  handle: DocumentViewerHandle | null,
  opts: EntityMarkers2DOptions,
): void {
  const { projectId, fileId, page, enabled } = opts;
  const scopedFileId = enabled ? fileId : null;
  const scopedPage = enabled ? page : null;

  const findingMarkers = usePageFindingMarkers(projectId, scopedFileId, scopedPage);
  const certMarkers = usePageCertificateMarkers(projectId, scopedFileId, scopedPage);

  // usePdfPageAttachments requires a non-null fileId but is gated by page, so an
  // empty string is harmless when disabled (page === null).
  const attachments = usePdfPageAttachments(projectId, scopedFileId ?? '', scopedPage).data ?? [];
  const attachmentMarkers = useMemo<EntityMarker2D[]>(
    () =>
      attachments
        .filter((a) => a.anchor_x != null && a.anchor_y != null)
        .map((a) => ({
          id: a.id,
          type: 'attachment' as const,
          x: a.anchor_x!,
          y: a.anchor_y!,
          label: a.original_filename,
          entityId: a.id,
        })),
    [attachments],
  );

  const allMarkers = useMemo(
    () => [...findingMarkers, ...certMarkers, ...attachmentMarkers],
    [findingMarkers, certMarkers, attachmentMarkers],
  );

  useEffect(() => {
    if (!handle || !enabled) return;
    handle.commands.execute('entity-marker-2d.sync', allMarkers).catch(() => undefined);
  }, [handle, enabled, allMarkers]);

  // Lookup maps so click resolution is O(1) rather than a linear scan per click.
  const findings = flattenPages(useFileFindings(projectId, scopedFileId).data);
  const certificates = flattenPages(useFileCertificates(projectId, scopedFileId).data);
  const findingMap = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const certMap = useMemo(() => new Map(certificates.map((c) => [c.id, c])), [certificates]);
  const attachmentMap = useMemo(() => new Map(attachments.map((a) => [a.id, a])), [attachments]);

  // Keep callbacks in a ref so subscriptions don't churn when handlers change.
  const cbRef = useRef(opts);
  cbRef.current = opts;

  useEffect(() => {
    if (!handle || !enabled) return undefined;
    const offClick = handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findingMap.get(ev.entityId);
        if (f) cbRef.current.onFindingClick(f);
      } else if (ev.type === 'certificate') {
        const c = certMap.get(ev.entityId);
        if (c) cbRef.current.onCertificateClick(c);
      } else if (ev.type === 'attachment') {
        const a = attachmentMap.get(ev.entityId);
        if (a) cbRef.current.onAttachmentClick(a);
      }
    });
    const offPlace = handle.events.on('entity-marker:place', (ev) => {
      cbRef.current.onPlace(ev);
    });
    return () => {
      offClick();
      offPlace();
    };
  }, [handle, enabled, findingMap, certMap, attachmentMap]);
}
