import { getDb } from './db';

// Generic read-mirror cache. Rows are keyed by (entity, scope, id); `scope` is
// usually a projectId (or 'all' for the org-wide project list). The full server
// payload is stored as JSON so the cached read returns exactly what the network
// would have. `server_updated_at` is captured for the Phase-6 conflict baseline.

export type CacheableRow = { id: string; updated_at?: string };

const now = (): number => new Date().getTime();

/**
 * Replace the cached set for (entity, scope) with `rows`, preserving server
 * order via `seq`. Rows whose id is absent from the new set are deleted — this
 * is caching server truth on a successful online read, NOT pruning local edits
 * (those live in the outbox and are overlaid separately).
 */
export async function putList<T extends CacheableRow>(
  entity: string,
  scope: string,
  rows: T[],
): Promise<void> {
  const db = await getDb();
  const ts = now();
  const ids = rows.map((r) => r.id);
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      await db.runAsync(
        `INSERT INTO cache_rows (entity, scope, id, seq, data, server_updated_at, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity, scope, id) DO UPDATE SET
           seq = excluded.seq, data = excluded.data,
           server_updated_at = excluded.server_updated_at, cached_at = excluded.cached_at`,
        entity,
        scope,
        r.id,
        i,
        JSON.stringify(r),
        r.updated_at ?? null,
        ts,
      );
    }
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(
        `DELETE FROM cache_rows WHERE entity = ? AND scope = ? AND id NOT IN (${placeholders})`,
        entity,
        scope,
        ...ids,
      );
    } else {
      await db.runAsync('DELETE FROM cache_rows WHERE entity = ? AND scope = ?', entity, scope);
    }
  });
}

export async function getList<T>(entity: string, scope: string): Promise<T[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>(
    'SELECT data FROM cache_rows WHERE entity = ? AND scope = ? ORDER BY seq ASC',
    entity,
    scope,
  );
  return rows.map((r) => JSON.parse(r.data) as T);
}

/** Upsert a single row without disturbing its list position (`seq` untouched on
 * conflict, default 0 for a brand-new row). */
export async function putOne<T extends CacheableRow>(
  entity: string,
  scope: string,
  row: T,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO cache_rows (entity, scope, id, seq, data, server_updated_at, cached_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(entity, scope, id) DO UPDATE SET
       data = excluded.data, server_updated_at = excluded.server_updated_at,
       cached_at = excluded.cached_at`,
    entity,
    scope,
    row.id,
    JSON.stringify(row),
    row.updated_at ?? null,
    now(),
  );
}

export async function removeRow(entity: string, scope: string, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM cache_rows WHERE entity = ? AND scope = ? AND id = ?',
    entity,
    scope,
    id,
  );
}

export async function getOne<T>(entity: string, scope: string, id: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM cache_rows WHERE entity = ? AND scope = ? AND id = ?',
    entity,
    scope,
    id,
  );
  return row !== null ? (JSON.parse(row.data) as T) : null;
}
