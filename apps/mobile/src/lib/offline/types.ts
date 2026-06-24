import type { CapturedPhoto } from '@/features/photos/capture';
import type { FindingCreateInput } from '@/lib/api/schemas/findings';

// Outbox model. v1 exercises `create_finding` + `upload_photo`; update/delete
// are reserved so the schema + engine extend without a migration.
export type OutboxKind = 'create_finding' | 'update_finding' | 'delete_finding' | 'upload_photo';

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'conflicted' | 'succeeded';

export type CreateFindingPayload = { input: FindingCreateInput };

export type UploadPhotoPayload = { photo: CapturedPhoto };

export type OutboxEntry = {
  id: number;
  /** Client-minted temp id of the created row (temp-<uuid>); remapped to the
   * real server id after sync. */
  tempId: string;
  /** Sent as the Idempotency-Key so a replay after a lost response is deduped.
   * Minted once at enqueue and never regenerated on retry. */
  idempotencyKey: string;
  kind: OutboxKind;
  status: OutboxStatus;
  /** The projectId this write belongs to. */
  scope: string;
  payload: unknown;
  /** Cached server updated_at captured when the edit was made (Phase 6 conflict
   * baseline). */
  baseUpdatedAt: string | null;
  /** Outbox ids this entry depends on (e.g. a create on its photo uploads). */
  dependsOn: number[];
  conflictJson: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: number;
};

export type NewOutboxEntry = {
  tempId: string;
  idempotencyKey: string;
  kind: OutboxKind;
  scope: string;
  payload: unknown;
  baseUpdatedAt?: string | null;
  dependsOn?: number[];
};
