import { uploadPhoto } from '@/features/photos/upload';
import { ApiError } from '@/lib/api/client';
import { createFinding } from '@/lib/api/findings';
import type { Finding, FindingCreateInput } from '@/lib/api/schemas/findings';
import { tokenManager } from '@/lib/api/tokenManager';

import { putOne, removeRow } from './cache';
import { getNetworkStatus } from './networkStatus';
import { getMeta, listPending, removeEntry, setMeta, updateEntry } from './outbox';
import type { CreateFindingPayload, OutboxEntry, UploadPhotoPayload } from './types';

const TEMP_PHOTO_PREFIX = 'temp-photo-';
const photoMapKey = (tempPhotoId: string): string => `photomap:${tempPhotoId}`;

const MAX_ATTEMPTS = 5;
const backoffMs = (attempts: number): number => Math.min(1000 * 2 ** attempts, 60_000);

export type SyncState = 'idle' | 'syncing' | 'error';

type CreateOutcome = 'ok' | 'transient' | 'failed';

/**
 * Drains the outbox to the server. Triggered on reconnect, app-foreground, and
 * manually (no background poll on a phone). Replays are deduped server-side by
 * the Idempotency-Key, so a lost response never double-creates a snag.
 *
 * v1 handles `create_finding`. Order, temp→real remap, backoff, and the
 * transient/permanent split are generic so the other kinds (update/delete/photo)
 * slot in without reshaping the engine.
 */
export class SyncEngine {
  private syncing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SyncState = 'idle';
  private getToken: () => string | null = () => null;
  private onChange: () => void = () => undefined;

  configure(getToken: () => string | null, onChange: () => void): void {
    this.getToken = getToken;
    this.onChange = onChange;
  }

  getState(): SyncState {
    return this.state;
  }

  private setState(next: SyncState): void {
    if (next !== this.state) {
      this.state = next;
      this.onChange();
    }
  }

  async run(): Promise<void> {
    if (this.syncing) return;
    const token = this.getToken();
    if (token === null || !getNetworkStatus()) return;

    this.syncing = true;
    this.setState('syncing');
    let hadTransient = false;
    try {
      const pending = await listPending();
      // Order: photos → creates (→ updates → deletes when added). Photos go
      // first so a finding create can resolve its temp photo ids to real
      // attachment ids in the same pass.
      for (const entry of pending) {
        if (entry.kind !== 'upload_photo') continue;
        const outcome = await this.syncPhoto(entry, token);
        if (outcome === 'transient') hadTransient = true;
      }
      for (const entry of pending) {
        if (entry.kind !== 'create_finding') continue;
        const outcome = await this.syncCreate(entry, token);
        if (outcome === 'transient') hadTransient = true;
      }
      this.setState('idle');
    } catch {
      this.setState('error');
    } finally {
      this.syncing = false;
      this.onChange();
      if (hadTransient) this.scheduleRetry();
    }
  }

  stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, backoffMs(1));
  }

  private async syncCreate(entry: OutboxEntry, token: string): Promise<CreateOutcome> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await updateEntry(entry.id, { status: 'failed', lastError: 'Max attempts reached' });
      return 'failed';
    }
    const { input } = entry.payload as CreateFindingPayload;

    // Resolve any queued temp photo ids → real attachment ids (photos synced
    // first this pass). If a photo hasn't uploaded yet, wait — re-arm as pending
    // WITHOUT burning an attempt, so a slow photo can't fail the finding.
    const resolved = await this.resolvePhotoIds(input.photo_ids ?? null);
    if (resolved === 'unresolved') {
      await updateEntry(entry.id, { status: 'pending' });
      return 'transient';
    }
    const finalInput: FindingCreateInput = { ...input, photo_ids: resolved };

    await updateEntry(entry.id, { status: 'syncing' });
    try {
      const finding = await this.createWithRefresh(
        token,
        entry.scope,
        finalInput,
        entry.idempotencyKey,
      );
      // temp → real remap: drop the optimistic row, cache the server row.
      await putOne('finding', entry.scope, finding);
      await removeRow('finding', entry.scope, entry.tempId);
      await removeEntry(entry.id);
      return 'ok';
    } catch (error) {
      // 5xx / network / 409 (idempotency in-flight) are transient → retry with
      // backoff. Other 4xx are permanent → park as failed for a manual retry.
      const transient =
        !(error instanceof ApiError) || error.status >= 500 || error.status === 409;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await updateEntry(entry.id, {
        status: transient ? 'pending' : 'failed',
        attempts: entry.attempts + 1,
        lastError: message,
      });
      return transient ? 'transient' : 'failed';
    }
  }

  private async createWithRefresh(
    token: string,
    projectId: string,
    input: FindingCreateInput,
    idempotencyKey: string,
  ): Promise<Finding> {
    try {
      return await createFinding(token, projectId, input, idempotencyKey);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const fresh = await tokenManager.refresh();
        return createFinding(fresh, projectId, input, idempotencyKey);
      }
      throw error;
    }
  }

  /** Map temp photo ids to their real attachment ids, passing real ids through.
   * Returns 'unresolved' if any queued photo hasn't uploaded yet. */
  private async resolvePhotoIds(
    photoIds: string[] | null,
  ): Promise<string[] | null | 'unresolved'> {
    if (photoIds === null || photoIds.length === 0) return null;
    const out: string[] = [];
    for (const id of photoIds) {
      if (id.startsWith(TEMP_PHOTO_PREFIX)) {
        const real = await getMeta(photoMapKey(id));
        if (real === null) return 'unresolved';
        out.push(real);
      } else {
        out.push(id);
      }
    }
    return out.length > 0 ? out : null;
  }

  private async syncPhoto(entry: OutboxEntry, token: string): Promise<CreateOutcome> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await updateEntry(entry.id, { status: 'failed', lastError: 'Max attempts reached' });
      return 'failed';
    }
    await updateEntry(entry.id, { status: 'syncing' });
    const { photo } = entry.payload as UploadPhotoPayload;
    try {
      const realId = await uploadPhoto(token, entry.scope, photo);
      // Record the mapping so create_finding entries can swap temp → real, even
      // across an interrupted pass, then drop the photo entry.
      await setMeta(photoMapKey(entry.tempId), realId);
      await removeEntry(entry.id);
      return 'ok';
    } catch (error) {
      const transient =
        !(error instanceof ApiError) || error.status >= 500 || error.status === 409;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await updateEntry(entry.id, {
        status: transient ? 'pending' : 'failed',
        attempts: entry.attempts + 1,
        lastError: message,
      });
      return transient ? 'transient' : 'failed';
    }
  }
}

export const syncEngine = new SyncEngine();
