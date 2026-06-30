import { uploadPhoto } from '@/features/photos/upload';
import { ApiError } from '@/lib/api/client';
import { createFinding, getFinding, updateFinding } from '@/lib/api/findings';
import {
  createPooledFinding,
  getPooledFinding,
  updatePooledFinding,
} from '@/lib/api/pooledFindings';
import type { Finding, FindingCreateInput, FindingUpdateInput } from '@/lib/api/schemas/findings';
import { tokenManager } from '@/lib/api/tokenManager';
import { readCachedMe } from '@/lib/auth/cachedMe';

import { putOne, removeRow } from './cache';
import { getNetworkStatus } from './networkStatus';
import { getMeta, listPending, removeEntry, setMeta, updateEntry } from './outbox';
import type {
  CreateFindingPayload,
  OutboxEntry,
  UpdateFindingPayload,
  UploadPhotoPayload,
} from './types';

const TEMP_PHOTO_PREFIX = 'temp-photo-';
const TEMP_FINDING_PREFIX = 'temp-';
const photoMapKey = (tempPhotoId: string): string => `photomap:${tempPhotoId}`;
// Maps an offline-created finding's temp id → its real server id, so an update
// queued before the create synced (create-then-resolve offline) targets the real
// finding. Set on create success, read at the start of an update.
const findingMapKey = (tempFindingId: string): string => `findingmap:${tempFindingId}`;

const MAX_ATTEMPTS = 5;
const backoffMs = (attempts: number): number => Math.min(1000 * 2 ** attempts, 60_000);

export type SyncState = 'idle' | 'syncing' | 'error';

type CreateOutcome = 'ok' | 'transient' | 'failed';

/**
 * Drains the outbox to the server. Triggered on reconnect, app-foreground, and
 * manually (no background poll on a phone). Replays are deduped server-side by
 * the Idempotency-Key, so a lost response never double-creates a snag.
 *
 * Handles `upload_photo` → `create_finding` → `update_finding` (in that order so
 * a create resolves its temp photo ids, and an update resolves both its evidence
 * photos and a freshly-created finding's real id). An update whose status
 * transition is no longer legal on replay is parked as a conflict (server wins).
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
      // Route this drain to the free or paid endpoints based on the cached
      // /auth/me — a free user is org-less (no `org` JWT claim). The cache is
      // written on every /auth/me + cleared on logout/org-switch, so it's the
      // right source for the non-React sync engine.
      const me = await readCachedMe();
      const isFree = me !== null && me.active_organization_id === null;
      const pending = await listPending();
      // Order: photos → creates (→ updates → deletes when added). Photos go
      // first so a finding create can resolve its temp photo ids to real
      // attachment ids in the same pass.
      for (const entry of pending) {
        if (entry.kind !== 'upload_photo') continue;
        const outcome = await this.syncPhoto(entry, token, isFree);
        if (outcome === 'transient') hadTransient = true;
      }
      for (const entry of pending) {
        if (entry.kind !== 'create_finding') continue;
        const outcome = await this.syncCreate(entry, token, isFree);
        if (outcome === 'transient') hadTransient = true;
      }
      for (const entry of pending) {
        if (entry.kind !== 'update_finding') continue;
        const outcome = await this.syncUpdate(entry, token, isFree);
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

  private async syncCreate(
    entry: OutboxEntry,
    token: string,
    isFree: boolean,
  ): Promise<CreateOutcome> {
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
        isFree,
      );
      // temp → real remap: drop the optimistic row, cache the server row, and
      // record the id mapping so an update queued before this create lands on
      // the real finding.
      await putOne('finding', entry.scope, finding);
      await removeRow('finding', entry.scope, entry.tempId);
      await setMeta(findingMapKey(entry.tempId), finding.id);
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
    isFree: boolean,
  ): Promise<Finding> {
    const doCreate = (t: string): Promise<Finding> =>
      isFree
        ? createPooledFinding(t, projectId, input, idempotencyKey)
        : createFinding(t, projectId, input, idempotencyKey);
    try {
      return await doCreate(token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const fresh = await tokenManager.refresh();
        return doCreate(fresh);
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

  private async syncUpdate(
    entry: OutboxEntry,
    token: string,
    isFree: boolean,
  ): Promise<CreateOutcome> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await updateEntry(entry.id, { status: 'failed', lastError: 'Max attempts reached' });
      return 'failed';
    }
    const { findingId, input } = entry.payload as UpdateFindingPayload;

    // If this update targets an offline-created finding, wait for its create to
    // assign a real id (created earlier in this same pass), then retarget.
    let realFindingId = findingId;
    if (findingId.startsWith(TEMP_FINDING_PREFIX)) {
      const mapped = await getMeta(findingMapKey(findingId));
      if (mapped === null) {
        await updateEntry(entry.id, { status: 'pending' });
        return 'transient';
      }
      realFindingId = mapped;
    }

    // Resolve any queued evidence-photo temp ids → real attachment ids.
    let finalInput: FindingUpdateInput = input;
    if (input.resolution_evidence_ids !== undefined) {
      const resolved = await this.resolvePhotoIds(input.resolution_evidence_ids);
      if (resolved === 'unresolved') {
        await updateEntry(entry.id, { status: 'pending' });
        return 'transient';
      }
      finalInput = { ...input, resolution_evidence_ids: resolved };
    }

    await updateEntry(entry.id, { status: 'syncing' });
    try {
      const finding = await this.updateWithRefresh(
        token,
        entry.scope,
        realFindingId,
        finalInput,
        isFree,
      );
      await putOne('finding', entry.scope, finding);
      await removeEntry(entry.id);
      return 'ok';
    } catch (error) {
      // 422 (illegal transition / stale evidence gate) means the finding changed
      // under us → conflict; the server wins. Overwrite the cache with the
      // current server row (best-effort) and park the entry as conflicted.
      if (error instanceof ApiError && error.status === 422) {
        await this.overwriteWithServer(token, entry.scope, realFindingId, isFree);
        await updateEntry(entry.id, {
          status: 'conflicted',
          conflictJson: JSON.stringify({ code: error.detail }),
          lastError: error.detail,
        });
        return 'failed';
      }
      // 5xx / network / 409 retry; other 4xx (e.g. 403 verify-not-inspector) park
      // as failed for a manual retry.
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

  private async updateWithRefresh(
    token: string,
    projectId: string,
    findingId: string,
    input: FindingUpdateInput,
    isFree: boolean,
  ): Promise<Finding> {
    const doUpdate = (t: string): Promise<Finding> =>
      isFree
        ? updatePooledFinding(t, projectId, findingId, input)
        : updateFinding(t, projectId, findingId, input);
    try {
      return await doUpdate(token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const fresh = await tokenManager.refresh();
        return doUpdate(fresh);
      }
      throw error;
    }
  }

  /** Best-effort: replace the cached finding with the server's current state so a
   * resolved conflict shows server truth next time the detail is opened. */
  private async overwriteWithServer(
    token: string,
    projectId: string,
    findingId: string,
    isFree: boolean,
  ): Promise<void> {
    try {
      const fresh = isFree
        ? await getPooledFinding(token, projectId, findingId)
        : await getFinding(token, projectId, findingId);
      await putOne('finding', projectId, fresh);
    } catch {
      // Leave the cache as-is if the refetch fails.
    }
  }

  private async syncPhoto(
    entry: OutboxEntry,
    token: string,
    isFree: boolean,
  ): Promise<CreateOutcome> {
    if (entry.attempts >= MAX_ATTEMPTS) {
      await updateEntry(entry.id, { status: 'failed', lastError: 'Max attempts reached' });
      return 'failed';
    }
    await updateEntry(entry.id, { status: 'syncing' });
    const { photo } = entry.payload as UploadPhotoPayload;
    try {
      const realId = await uploadPhoto(token, entry.scope, photo, isFree);
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
