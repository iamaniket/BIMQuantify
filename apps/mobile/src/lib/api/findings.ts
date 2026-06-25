import { apiClient } from './client';
import {
  FindingSchema,
  FindingListSchema,
  type Finding,
  type FindingList,
  type FindingCreateInput,
  type FindingUpdateInput,
} from './schemas/findings';

export async function listFindings(
  token: string,
  projectId: string,
): Promise<FindingList> {
  return apiClient.get(
    `/projects/${projectId}/findings`,
    FindingListSchema,
    token,
  );
}

export async function getFinding(
  token: string,
  projectId: string,
  findingId: string,
): Promise<Finding> {
  return apiClient.get(
    `/projects/${projectId}/findings/${findingId}`,
    FindingSchema,
    token,
  );
}

export async function createFinding(
  token: string,
  projectId: string,
  input: FindingCreateInput,
  idempotencyKey?: string,
): Promise<Finding> {
  return apiClient.post(
    `/projects/${projectId}/findings`,
    input,
    FindingSchema,
    token,
    idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

// Status transitions (promote/start/resolve/verify/reopen) + resolution evidence.
// PATCH is naturally idempotent on replay: a same-status write is a server-side
// no-op, and a now-illegal transition returns 422 — the sync engine treats that
// as a conflict (the finding moved underneath us).
export async function updateFinding(
  token: string,
  projectId: string,
  findingId: string,
  input: FindingUpdateInput,
): Promise<Finding> {
  return apiClient.patch(
    `/projects/${projectId}/findings/${findingId}`,
    input,
    FindingSchema,
    token,
  );
}
