import { getDb } from './db';
import type { NewOutboxEntry, OutboxEntry, OutboxKind, OutboxStatus } from './types';

type OutboxRow = {
  id: number;
  temp_id: string;
  idempotency_key: string;
  kind: string;
  status: string;
  scope: string;
  payload: string;
  base_updated_at: string | null;
  depends_on: string | null;
  conflict_json: string | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
};

function toEntry(r: OutboxRow): OutboxEntry {
  return {
    id: r.id,
    tempId: r.temp_id,
    idempotencyKey: r.idempotency_key,
    kind: r.kind as OutboxKind,
    status: r.status as OutboxStatus,
    scope: r.scope,
    payload: JSON.parse(r.payload) as unknown,
    baseUpdatedAt: r.base_updated_at,
    dependsOn: r.depends_on !== null ? (JSON.parse(r.depends_on) as number[]) : [],
    conflictJson: r.conflict_json,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

export async function enqueue(entry: NewOutboxEntry): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `INSERT INTO outbox
       (temp_id, idempotency_key, kind, status, scope, payload, base_updated_at, depends_on, attempts, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)`,
    entry.tempId,
    entry.idempotencyKey,
    entry.kind,
    entry.scope,
    JSON.stringify(entry.payload),
    entry.baseUpdatedAt ?? null,
    entry.dependsOn !== undefined ? JSON.stringify(entry.dependsOn) : null,
    new Date().getTime(),
  );
  return res.lastInsertRowId;
}

/** Pending entries (FIFO) ready to sync. */
export async function listPending(): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE status = 'pending' ORDER BY id ASC",
  );
  return rows.map(toEntry);
}

/** Every not-yet-synced entry (pending / syncing / failed / conflicted), for the
 * UI pending snapshot. */
export async function listActive(): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox WHERE status != 'succeeded' ORDER BY id ASC",
  );
  return rows.map(toEntry);
}

export async function updateEntry(
  id: number,
  fields: Partial<{
    status: OutboxStatus;
    attempts: number;
    lastError: string | null;
    conflictJson: string | null;
  }>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.status !== undefined) {
    sets.push('status = ?');
    params.push(fields.status);
  }
  if (fields.attempts !== undefined) {
    sets.push('attempts = ?');
    params.push(fields.attempts);
  }
  if (fields.lastError !== undefined) {
    sets.push('last_error = ?');
    params.push(fields.lastError);
  }
  if (fields.conflictJson !== undefined) {
    sets.push('conflict_json = ?');
    params.push(fields.conflictJson);
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.runAsync(`UPDATE outbox SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

export async function removeEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE id = ?', id);
}

/** Re-arm failed entries for another sync pass (manual retry). */
export async function resetFailedToPending(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE outbox SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed'",
  );
}

// --- sync_meta: small durable key/value used for the temp-photo-id → real
// attachment-id map (so a create can resolve its photos across sync passes). ---

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    key,
  );
  return row !== null ? row.value : null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().getTime(),
  );
}
