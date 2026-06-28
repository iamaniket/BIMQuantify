/**
 * Pure helper for federated storey isolation (Phase 3). Extracted from
 * {@link useFederatedLevelMembership} so the cross-model union — every
 * discipline's storey elements grouped by their shared project Level — is
 * unit-testable without React Query.
 */

/** A `{ modelId, localId }` element key (viewer scene id = `file-<fileId>`). */
export type IsolateItem = { modelId: string; localId: number };

/** One model's contribution to the union. */
export type MembershipModel = {
  /** Viewer scene id (`file-<fileId>`) — every item is tagged with it. */
  viewerModelId: string;
  /** storeyExpressId -> element localIds (from `buildStoreyMembership`). */
  membership: Map<number, number[]>;
  /** This model's storeys (express_id + reconciled project level_id). */
  storeys: Array<{ express_id: number | null; level_id: string | null }>;
};

/**
 * Union every model's storey elements by their shared project Level:
 * `level_id -> [{ modelId, localId }]`. A storey with no reconciled Level, or no
 * elements, contributes nothing (the model stays visible — never blanked).
 */
export function unionMembershipByLevel(models: MembershipModel[]): Map<string, IsolateItem[]> {
  const byLevel = new Map<string, IsolateItem[]>();
  for (const { viewerModelId, membership, storeys } of models) {
    for (const s of storeys) {
      if (s.express_id == null || s.level_id == null) continue;
      const localIds = membership.get(s.express_id);
      if (!localIds || localIds.length === 0) continue;
      const arr = byLevel.get(s.level_id) ?? [];
      for (const localId of localIds) arr.push({ modelId: viewerModelId, localId });
      byLevel.set(s.level_id, arr);
    }
  }
  return byLevel;
}
