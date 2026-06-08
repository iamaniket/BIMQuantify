import {
  completeAttachmentUpload,
  initiateAttachmentUpload,
} from '@/lib/api/attachments.js';
import { apiClient } from '@/lib/api/client.js';
import {
  completeInspection,
  startInspection,
  submitResult,
} from '@/lib/api/inspection.js';
import { tokenManager } from '@/lib/auth/tokenManager.js';

import { getNetworkStatus } from './networkStatus.js';
import {
  clearSucceeded,
  markFailed,
  markSucceeded,
  markSyncing,
  peekPending,
} from './queue.js';
import type {
  CompleteInspectionEntry,
  QueueEntry,
  StartInspectionEntry,
  SubmitResultEntry,
  SyncResult,
  UploadPhotoEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

type SyncListener = (state: SyncState) => void;

export type SyncState =
  | { phase: 'idle' }
  | { phase: 'syncing'; total: number; completed: number }
  | { phase: 'done'; result: SyncResult }
  | { phase: 'error'; message: string };

const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number): number {
  return Math.min(1000 * Math.pow(2, attempts), 60_000);
}

function isTransientError(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    const status = (err as { status: number }).status;
    return status >= 500 || status === 0;
  }
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  return false;
}

function isConflict(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    return (err as { status: number }).status === 409;
  }
  return false;
}

export class SyncEngine {
  private listeners = new Set<SyncListener>();
  private state: SyncState = { phase: 'idle' };
  private syncInFlight = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private boundOnline = (): void => { void this.syncNow(); };
  private boundVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    window.addEventListener('online', this.boundOnline);
    document.addEventListener('visibilitychange', this.boundVisibility);
    this.intervalId = setInterval(() => {
      if (getNetworkStatus()) void this.syncNow();
    }, 30_000);
  }

  stop(): void {
    window.removeEventListener('online', this.boundOnline);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private emit(state: SyncState): void {
    this.state = state;
    for (const l of this.listeners) l(state);
  }

  // -------------------------------------------------------------------------
  // Main sync loop
  // -------------------------------------------------------------------------

  async syncNow(): Promise<SyncResult> {
    if (this.syncInFlight) return { synced: 0, failed: 0, conflicts: 0 };
    if (!getNetworkStatus()) return { synced: 0, failed: 0, conflicts: 0 };

    this.syncInFlight = true;
    const result: SyncResult = { synced: 0, failed: 0, conflicts: 0 };

    try {
      const pending = await peekPending();
      if (pending.length === 0) {
        this.emit({ phase: 'idle' });
        return result;
      }

      this.emit({ phase: 'syncing', total: pending.length, completed: 0 });

      const photos = pending.filter((e): e is UploadPhotoEntry => e.type === 'upload_photo');
      const starts = pending.filter((e): e is StartInspectionEntry => e.type === 'start_inspection');
      const results = pending.filter((e): e is SubmitResultEntry => e.type === 'submit_result');
      const completes = pending.filter((e): e is CompleteInspectionEntry => e.type === 'complete_inspection');

      const photoIdMap = new Map<string, string>();

      for (const entry of photos) {
        const entryResult = await this.syncPhoto(entry);
        if (entryResult.succeeded) {
          result.synced++;
          if (entryResult.realId !== undefined) {
            photoIdMap.set(entry.tempPhotoId, entryResult.realId);
          }
        } else if (entryResult.conflict) {
          result.conflicts++;
        } else {
          result.failed++;
        }
        this.emit({ phase: 'syncing', total: pending.length, completed: result.synced + result.failed + result.conflicts });
      }

      for (const entry of starts) {
        const ok = await this.syncEntry(entry, () => this.syncStart(entry));
        if (ok) result.synced++; else result.failed++;
        this.emit({ phase: 'syncing', total: pending.length, completed: result.synced + result.failed + result.conflicts });
      }

      for (const entry of results) {
        if (entry.payload.tempPhotoIds !== undefined && entry.payload.tempPhotoIds.length > 0) {
          const resolved = entry.payload.tempPhotoIds.map((tid) => photoIdMap.get(tid)).filter((id): id is string => id !== undefined);
          const existingIds = (entry.payload.input.photo_ids ?? []).filter((id) => !id.startsWith('temp-'));
          entry.payload.input = {
            ...entry.payload.input,
            photo_ids: [...existingIds, ...resolved].length > 0 ? [...existingIds, ...resolved] : null,
          };
        }

        const ok = await this.syncEntry(entry, () => this.syncResult(entry));
        if (ok) result.synced++; else result.failed++;
        this.emit({ phase: 'syncing', total: pending.length, completed: result.synced + result.failed + result.conflicts });
      }

      for (const entry of completes) {
        const ok = await this.syncEntry(entry, () => this.syncComplete(entry));
        if (ok) result.synced++; else result.failed++;
        this.emit({ phase: 'syncing', total: pending.length, completed: result.synced + result.failed + result.conflicts });
      }

      await clearSucceeded();
      this.emit({ phase: 'done', result });
    } catch (err) {
      this.emit({ phase: 'error', message: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      this.syncInFlight = false;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Per-entry sync helpers
  // -------------------------------------------------------------------------

  private async syncEntry(entry: QueueEntry, fn: () => Promise<void>): Promise<boolean> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await markFailed(entry.id, 'Max attempts reached');
      return false;
    }

    await markSyncing(entry.id);
    try {
      await fn();
      await markSucceeded(entry.id);
      return true;
    } catch (err) {
      if (isConflict(err)) {
        await markSucceeded(entry.id);
        return true;
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (isTransientError(err)) {
        await markFailed(entry.id, msg);
        await this.sleep(backoffMs(entry.attempts));
      } else {
        await markFailed(entry.id, msg);
      }
      return false;
    }
  }

  private async syncPhoto(entry: UploadPhotoEntry): Promise<{
    succeeded: boolean;
    conflict: boolean;
    realId?: string;
  }> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await markFailed(entry.id, 'Max attempts reached');
      return { succeeded: false, conflict: false };
    }

    await markSyncing(entry.id);
    try {
      const accessToken = await tokenManager.refresh();

      const initResponse = await initiateAttachmentUpload(accessToken, entry.projectId, {
        filename: entry.photoMeta.filename,
        size_bytes: entry.photoMeta.size,
        content_type: entry.photoMeta.contentType,
        content_sha256: entry.photoMeta.sha256,
        capture_metadata: entry.photoMeta.captureMetadata ?? null,
      });

      await apiClient.putRaw(
        initResponse.upload_url,
        entry.photoBlob,
        entry.photoMeta.contentType,
      );

      const attachment = await completeAttachmentUpload(
        accessToken,
        entry.projectId,
        initResponse.attachment_id,
      );

      await markSucceeded(entry.id);
      return { succeeded: true, conflict: false, realId: attachment.id };
    } catch (err) {
      if (isConflict(err)) {
        await markSucceeded(entry.id);
        return { succeeded: true, conflict: true };
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await markFailed(entry.id, msg);
      return { succeeded: false, conflict: false };
    }
  }

  private async syncStart(entry: StartInspectionEntry): Promise<void> {
    const accessToken = await tokenManager.refresh();
    await startInspection(accessToken, entry.momentId);
  }

  private async syncResult(entry: SubmitResultEntry): Promise<void> {
    const accessToken = await tokenManager.refresh();
    await submitResult(accessToken, entry.momentId, entry.payload.itemId, entry.payload.input);
  }

  private async syncComplete(entry: CompleteInspectionEntry): Promise<void> {
    const accessToken = await tokenManager.refresh();
    await completeInspection(accessToken, entry.momentId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (instance === null) {
    instance = new SyncEngine();
  }
  return instance;
}
