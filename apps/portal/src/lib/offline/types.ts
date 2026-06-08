import type {
  Borgingsplan,
  ChecklistItemResult,
  InspectionVerdictValue,
  ResultCreateInput,
} from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// Inspection cache (read-side: plan + results cached for offline access)
// ---------------------------------------------------------------------------

export interface CachedInspection {
  borgingsplan: Borgingsplan;
  results: ChecklistItemResult[];
  photoThumbnails: Record<string, Blob>;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Offline queue entry (write-side: mutations queued for replay when online)
// ---------------------------------------------------------------------------

export type QueueEntryType =
  | 'start_inspection'
  | 'submit_result'
  | 'complete_inspection'
  | 'upload_photo';

export type QueueEntryStatus = 'pending' | 'syncing' | 'failed' | 'succeeded';

export interface QueueEntryBase {
  id: number;
  type: QueueEntryType;
  status: QueueEntryStatus;
  projectId: string;
  momentId: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface StartInspectionEntry extends QueueEntryBase {
  type: 'start_inspection';
}

export interface SubmitResultEntry extends QueueEntryBase {
  type: 'submit_result';
  payload: {
    itemId: string;
    input: ResultCreateInput;
    tempPhotoIds?: string[] | undefined;
  };
}

export interface CompleteInspectionEntry extends QueueEntryBase {
  type: 'complete_inspection';
}

export interface UploadPhotoEntry extends QueueEntryBase {
  type: 'upload_photo';
  tempPhotoId: string;
  photoBlob: Blob;
  photoMeta: {
    filename: string;
    contentType: string;
    size: number;
    sha256: string;
    captureMetadata?: Record<string, unknown> | null;
  };
  thumbnail: Blob;
}

export type QueueEntry =
  | StartInspectionEntry
  | SubmitResultEntry
  | CompleteInspectionEntry
  | UploadPhotoEntry;

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type QueueEntryInput = DistributiveOmit<QueueEntry, 'id' | 'createdAt' | 'attempts' | 'status' | 'lastError'>;

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number;
  failed: number;
  conflicts: number;
}

export interface QueueStats {
  pending: number;
  failed: number;
}
