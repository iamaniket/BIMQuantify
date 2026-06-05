'use client';

import { useMemo } from 'react';

import { listAttachments } from '@/lib/api/attachments';
import { listCertificates } from '@/lib/api/certificates';
import { listFindings } from '@/lib/api/findings';
import type { Attachment, Certificate, Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

export type OrphanedElementItems = {
  findings: Finding[];
  certificates: Certificate[];
  attachments: Attachment[];
  total: number;
  /** True once the underlying queries AND the version metadata have resolved —
   * gates the notice so it never flashes a partial/empty state while loading. */
  ready: boolean;
};

const EMPTY: OrphanedElementItems = {
  findings: [],
  certificates: [],
  attachments: [],
  total: 0,
  ready: false,
};

/**
 * Element-linked items (findings / certificates / attachments) attached to this
 * model whose GlobalId is NOT present in the currently-open version's metadata —
 * i.e. the element was deleted or re-exported with a new GlobalId, so the item
 * would otherwise silently disappear from the viewer (#N9, "flag as orphaned").
 *
 * Fully client-side: the present-GlobalId set comes from the metadata artifact
 * already loaded for the open version, so detecting orphans costs no extra
 * round-trip beyond listing the model's element-linked items.
 */
export function useOrphanedElementItems(
  projectId: string,
  modelId: string,
  metadata: ModelMetadata | undefined,
  enabled = true,
): OrphanedElementItems {
  const findingsQuery = useAuthQuery({
    queryKey: ['projects', projectId, 'findings', 'model', modelId] as const,
    queryFn: (accessToken) => listFindings(accessToken, projectId, { linkedModelId: modelId }),
    enabled,
    staleTime: 30_000,
  });
  const certificatesQuery = useAuthQuery({
    queryKey: ['projects', projectId, 'certificates', 'model', modelId] as const,
    queryFn: (accessToken) => listCertificates(accessToken, projectId, { linkedModelId: modelId }),
    enabled,
    staleTime: 30_000,
  });
  const attachmentsQuery = useAuthQuery({
    queryKey: ['projects', projectId, 'attachments', 'model', modelId] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, { linkedModelId: modelId }),
    enabled,
    staleTime: 30_000,
  });

  const presentGlobalIds = useMemo(() => {
    const set = new Set<string>();
    for (const el of metadata?.elements ?? []) {
      if (el.globalId !== null) set.add(el.globalId);
    }
    return set;
  }, [metadata]);

  const findingsData = findingsQuery.data;
  const certificatesData = certificatesQuery.data;
  const attachmentsData = attachmentsQuery.data;

  return useMemo(() => {
    // Until the open version's metadata has loaded we cannot tell which
    // GlobalIds are present, so report nothing rather than flag everything.
    const haveMetadata = (metadata?.elements?.length ?? 0) > 0;
    if (
      !enabled
      || !haveMetadata
      || findingsQuery.isLoading
      || certificatesQuery.isLoading
      || attachmentsQuery.isLoading
    ) {
      return EMPTY;
    }

    const isOrphan = (g: string | null): g is string => g !== null && !presentGlobalIds.has(g);

    const fItems = findingsData ?? [];
    const cItems = certificatesData ?? [];
    const aItems = attachmentsData ?? [];
    const findings = fItems.filter((f) => isOrphan(f.linked_element_global_id));
    const certificates = cItems.filter((c) => isOrphan(c.linked_element_global_id));
    const attachments = aItems.filter((a) => isOrphan(a.linked_element_global_id));

    return {
      findings,
      certificates,
      attachments,
      total: findings.length + certificates.length + attachments.length,
      ready: true,
    };
  }, [
    enabled,
    metadata,
    presentGlobalIds,
    findingsQuery.isLoading,
    certificatesQuery.isLoading,
    attachmentsQuery.isLoading,
    findingsData,
    certificatesData,
    attachmentsData,
  ]);
}
