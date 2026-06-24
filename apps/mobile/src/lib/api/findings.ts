import { apiClient } from './client';
import {
  FindingSchema,
  FindingListSchema,
  type Finding,
  type FindingList,
  type FindingCreateInput,
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
