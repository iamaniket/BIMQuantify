import { getDb } from './db';

// Read-only summary of what the offline store currently holds, for the Settings
// "Offline data" section. `pendingWrites` is the count of not-yet-synced outbox
// entries (pending/syncing/failed/conflicted) — surfaced so a clear can warn
// before discarding unsynced snags.
export type OfflineStorageStats = {
  projects: number;
  findings: number;
  documents: number;
  pinnedCount: number;
  pinnedBytes: number;
  pendingWrites: number;
};

export async function getOfflineStorageStats(): Promise<OfflineStorageStats> {
  const db = await getDb();

  const cacheRows = await db.getAllAsync<{ entity: string; n: number }>(
    'SELECT entity, COUNT(*) AS n FROM cache_rows GROUP BY entity',
  );
  const byEntity = new Map(cacheRows.map((r) => [r.entity, r.n]));

  const pinned = await db.getFirstAsync<{ n: number; bytes: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM pinned_models',
  );

  const pending = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE status != 'succeeded'",
  );

  return {
    projects: byEntity.get('project') ?? 0,
    findings: byEntity.get('finding') ?? 0,
    documents: byEntity.get('document') ?? 0,
    pinnedCount: pinned?.n ?? 0,
    pinnedBytes: pinned?.bytes ?? 0,
    pendingWrites: pending?.n ?? 0,
  };
}
