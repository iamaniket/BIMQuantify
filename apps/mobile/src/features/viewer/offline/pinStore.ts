import * as FileSystem from 'expo-file-system/legacy';

import type { EmbedViewerBundle } from '@/lib/api/viewerBundle';
import { getDb } from '@/lib/offline/db';

// "Pin for offline": download a model's viewer-bundle artifacts to app storage
// and record a local manifest, so the model opens with no signal. Android-first
// — the WebView already sets allowFileAccessFromFileURLs, so the embed can fetch
// the file:// paths we hand it. (iOS has no in-app embed bundle yet; that, and
// the IndexedDB-prime alternative for large frags, are the device-spike items.)

const MODELS_DIR = `${FileSystem.documentDirectory ?? ''}offline/models/`;

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function downloadTo(url: string, dest: string): Promise<number> {
  await FileSystem.downloadAsync(url, dest);
  const info = await FileSystem.getInfoAsync(dest);
  return info.exists && info.size !== undefined ? info.size : 0;
}

/**
 * Download every artifact of `bundle` (presigned URLs, fetched while online) to
 * `offline/models/<fileId>/` and persist a local file:// manifest. Returns the
 * local bundle the viewer hands the embed when offline.
 */
export async function pinModel(
  projectId: string,
  modelId: string,
  fileId: string,
  bundle: EmbedViewerBundle,
): Promise<EmbedViewerBundle> {
  const dir = `${MODELS_DIR}${fileId}/`;
  await ensureDir(dir);

  const fragDest = `${dir}fragments.frag`;
  let total = await downloadTo(bundle.fragmentsUrl, fragDest);
  const local: EmbedViewerBundle = { fragmentsUrl: fragDest, modelId: bundle.modelId };
  if (bundle.cacheKey !== undefined) local.cacheKey = bundle.cacheKey;

  if (bundle.metadataUrl !== undefined) {
    const dest = `${dir}metadata.json`;
    total += await downloadTo(bundle.metadataUrl, dest);
    local.metadataUrl = dest;
  }
  if (bundle.propertiesUrl !== undefined) {
    const dest = `${dir}properties.json`;
    total += await downloadTo(bundle.propertiesUrl, dest);
    local.propertiesUrl = dest;
  }
  if (bundle.outlineUrl !== undefined) {
    const dest = `${dir}outline.bin`;
    total += await downloadTo(bundle.outlineUrl, dest);
    local.outlineUrl = dest;
  }
  if (bundle.floorPlansUrl !== undefined) {
    const dest = `${dir}floorplans.json`;
    total += await downloadTo(bundle.floorPlansUrl, dest);
    local.floorPlansUrl = dest;
  }

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pinned_models (file_id, project_id, model_id, cache_key, manifest, size_bytes, pinned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_id) DO UPDATE SET
       project_id = excluded.project_id, model_id = excluded.model_id,
       cache_key = excluded.cache_key, manifest = excluded.manifest,
       size_bytes = excluded.size_bytes, pinned_at = excluded.pinned_at`,
    fileId,
    projectId,
    modelId,
    bundle.cacheKey ?? null,
    JSON.stringify(local),
    total,
    new Date().getTime(),
  );
  return local;
}

export async function getPinnedBundle(fileId: string): Promise<EmbedViewerBundle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ manifest: string }>(
    'SELECT manifest FROM pinned_models WHERE file_id = ?',
    fileId,
  );
  return row !== null ? (JSON.parse(row.manifest) as EmbedViewerBundle) : null;
}

export async function isPinned(fileId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ file_id: string }>(
    'SELECT file_id FROM pinned_models WHERE file_id = ?',
    fileId,
  );
  return row !== null;
}

export async function unpinModel(fileId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pinned_models WHERE file_id = ?', fileId);
  try {
    await FileSystem.deleteAsync(`${MODELS_DIR}${fileId}/`, { idempotent: true });
  } catch {
    // Best-effort cleanup — the row is gone either way.
  }
}
