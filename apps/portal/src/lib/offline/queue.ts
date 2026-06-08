import { getDb } from './db.js';
import type { QueueEntry, QueueEntryInput, QueueEntryStatus, QueueStats } from './types.js';

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export async function enqueueAction(input: QueueEntryInput): Promise<number> {
  const db = await getDb();
  const entry = {
    ...input,
    status: 'pending' as QueueEntryStatus,
    createdAt: Date.now(),
    attempts: 0,
  };
  const id = await db.add('offlineQueue', entry as QueueEntry);
  return id;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function peekPending(): Promise<QueueEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('offlineQueue', 'by-status', 'pending');
}

export async function getFailedEntries(): Promise<QueueEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('offlineQueue', 'by-status', 'failed');
}

export async function getEntriesForMoment(momentId: string): Promise<QueueEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('offlineQueue', 'by-moment', momentId);
}

export async function getQueueStats(momentId?: string): Promise<QueueStats> {
  const db = await getDb();
  let entries: QueueEntry[];
  if (momentId !== undefined) {
    entries = await db.getAllFromIndex('offlineQueue', 'by-moment', momentId);
  } else {
    entries = await db.getAll('offlineQueue');
  }
  let pending = 0;
  let failed = 0;
  for (const e of entries) {
    if (e.status === 'pending' || e.status === 'syncing') pending++;
    if (e.status === 'failed') failed++;
  }
  return { pending, failed };
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export async function markSyncing(id: number): Promise<void> {
  const db = await getDb();
  const entry = await db.get('offlineQueue', id);
  if (entry === undefined) return;
  entry.status = 'syncing';
  await db.put('offlineQueue', entry);
}

export async function markSucceeded(id: number): Promise<void> {
  const db = await getDb();
  const entry = await db.get('offlineQueue', id);
  if (entry === undefined) return;
  entry.status = 'succeeded';
  await db.put('offlineQueue', entry);
}

export async function markFailed(id: number, error: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get('offlineQueue', id);
  if (entry === undefined) return;
  entry.status = 'failed';
  entry.attempts += 1;
  entry.lastError = error;
  await db.put('offlineQueue', entry);
}

export async function resetFailedToPending(): Promise<number> {
  const db = await getDb();
  const failed = await db.getAllFromIndex('offlineQueue', 'by-status', 'failed');
  const tx = db.transaction('offlineQueue', 'readwrite');
  let count = 0;
  for (const entry of failed) {
    entry.status = 'pending';
    void tx.store.put(entry);
    count++;
  }
  await tx.done;
  return count;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function clearSucceeded(): Promise<void> {
  const db = await getDb();
  const succeeded = await db.getAllFromIndex('offlineQueue', 'by-status', 'succeeded');
  const tx = db.transaction('offlineQueue', 'readwrite');
  for (const entry of succeeded) {
    void tx.store.delete(entry.id);
  }
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear('offlineQueue');
}
