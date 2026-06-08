import type { Borgingsplan, ChecklistItemResult } from '@/lib/api/schemas';

import { getDb } from './db.js';
import type { CachedInspection } from './types.js';

// ---------------------------------------------------------------------------
// Write-through cache for inspection data
// ---------------------------------------------------------------------------

export async function cacheInspectionData(
  projectId: string,
  momentId: string,
  borgingsplan: Borgingsplan,
  results: ChecklistItemResult[],
  photoThumbnails: Record<string, Blob> = {},
): Promise<void> {
  const db = await getDb();
  const entry: CachedInspection = {
    borgingsplan,
    results,
    photoThumbnails,
    cachedAt: Date.now(),
  };
  await db.put('inspectionCache', entry, [projectId, momentId]);
}

export async function getCachedInspection(
  projectId: string,
  momentId: string,
): Promise<CachedInspection | undefined> {
  const db = await getDb();
  return db.get('inspectionCache', [projectId, momentId]);
}

export async function clearInspectionCache(
  projectId: string,
  momentId: string,
): Promise<void> {
  const db = await getDb();
  await db.delete('inspectionCache', [projectId, momentId]);
}

export async function updateCachedResults(
  projectId: string,
  momentId: string,
  updater: (prev: ChecklistItemResult[]) => ChecklistItemResult[],
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('inspectionCache', [projectId, momentId]);
  if (existing === undefined) return;
  existing.results = updater(existing.results);
  await db.put('inspectionCache', existing, [projectId, momentId]);
}

export async function addCachedThumbnail(
  projectId: string,
  momentId: string,
  attachmentId: string,
  thumbnail: Blob,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('inspectionCache', [projectId, momentId]);
  if (existing === undefined) return;
  existing.photoThumbnails[attachmentId] = thumbnail;
  await db.put('inspectionCache', existing, [projectId, momentId]);
}
