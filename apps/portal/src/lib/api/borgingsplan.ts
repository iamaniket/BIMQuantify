import { apiClient } from './client';
import {
  BorgingsmomentSchema,
  BorgingsplanSchema,
  BorgingsplanVersionListSchema,
  ChecklistItemSchema,
  ChecklistItemListSchema,
  MomentListSchema,
  type Borgingsmoment,
  type BorgingsmomentCreateInput,
  type BorgingsmomentUpdateInput,
  type Borgingsplan,
  type BorgingsplanUpdateInput,
  type BorgingsplanVersionSummary,
  type ChecklistItem,
  type ChecklistItemCreateInput,
  type ChecklistItemReorderInput,
  type ChecklistItemUpdateInput,
  type GenerateOptionsInput,
  type MomentReorderInput,
} from './schemas';

// ----- Plan-level -----

export async function getBorgingsplan(
  accessToken: string,
  projectId: string,
): Promise<Borgingsplan | null> {
  try {
    return await apiClient.get<Borgingsplan>(
      `/projects/${projectId}/borgingsplan`,
      BorgingsplanSchema,
      accessToken,
    );
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

export async function listBorgingsplanVersions(
  accessToken: string,
  projectId: string,
): Promise<BorgingsplanVersionSummary[]> {
  return apiClient.get<BorgingsplanVersionSummary[]>(
    `/projects/${projectId}/borgingsplan/versions`,
    BorgingsplanVersionListSchema,
    accessToken,
  );
}

export async function generateBorgingsplan(
  accessToken: string,
  projectId: string,
  input: GenerateOptionsInput,
): Promise<Borgingsplan> {
  return apiClient.post<Borgingsplan>(
    `/projects/${projectId}/borgingsplan/generate`,
    input,
    BorgingsplanSchema,
    accessToken,
  );
}

export async function updateBorgingsplan(
  accessToken: string,
  projectId: string,
  input: BorgingsplanUpdateInput,
): Promise<Borgingsplan> {
  return apiClient.patch<Borgingsplan>(
    `/projects/${projectId}/borgingsplan`,
    input,
    BorgingsplanSchema,
    accessToken,
  );
}

export async function publishBorgingsplan(
  accessToken: string,
  projectId: string,
): Promise<Borgingsplan> {
  return apiClient.post<Borgingsplan>(
    `/projects/${projectId}/borgingsplan/publish`,
    {},
    BorgingsplanSchema,
    accessToken,
  );
}

export async function newBorgingsplanVersion(
  accessToken: string,
  projectId: string,
): Promise<Borgingsplan> {
  return apiClient.post<Borgingsplan>(
    `/projects/${projectId}/borgingsplan/new-version`,
    {},
    BorgingsplanSchema,
    accessToken,
  );
}

export async function resetBorgingsplan(
  accessToken: string,
  projectId: string,
  planId: string,
): Promise<Borgingsplan> {
  return apiClient.post<Borgingsplan>(
    `/projects/${projectId}/borgingsplan/${planId}/reset`,
    {},
    BorgingsplanSchema,
    accessToken,
  );
}

// ----- Moment-level -----

export async function createMoment(
  accessToken: string,
  planId: string,
  input: BorgingsmomentCreateInput,
): Promise<Borgingsmoment> {
  return apiClient.post<Borgingsmoment>(
    `/borgingsplans/${planId}/moments`,
    input,
    BorgingsmomentSchema,
    accessToken,
  );
}

export async function updateMoment(
  accessToken: string,
  planId: string,
  momentId: string,
  input: BorgingsmomentUpdateInput,
): Promise<Borgingsmoment> {
  return apiClient.patch<Borgingsmoment>(
    `/borgingsplans/${planId}/moments/${momentId}`,
    input,
    BorgingsmomentSchema,
    accessToken,
  );
}

export async function deleteMoment(
  accessToken: string,
  planId: string,
  momentId: string,
): Promise<void> {
  return apiClient.delete(`/borgingsplans/${planId}/moments/${momentId}`, accessToken);
}

export async function reorderMoments(
  accessToken: string,
  planId: string,
  input: MomentReorderInput,
): Promise<Borgingsmoment[]> {
  return apiClient.post<Borgingsmoment[]>(
    `/borgingsplans/${planId}/moments/reorder`,
    input,
    MomentListSchema,
    accessToken,
  );
}

// ----- Checklist items -----

export async function createChecklistItem(
  accessToken: string,
  momentId: string,
  input: ChecklistItemCreateInput,
): Promise<ChecklistItem> {
  return apiClient.post<ChecklistItem>(
    `/borgingsmomenten/${momentId}/checklist-items`,
    input,
    ChecklistItemSchema,
    accessToken,
  );
}

export async function updateChecklistItem(
  accessToken: string,
  momentId: string,
  itemId: string,
  input: ChecklistItemUpdateInput,
): Promise<ChecklistItem> {
  return apiClient.patch<ChecklistItem>(
    `/borgingsmomenten/${momentId}/checklist-items/${itemId}`,
    input,
    ChecklistItemSchema,
    accessToken,
  );
}

export async function deleteChecklistItem(
  accessToken: string,
  momentId: string,
  itemId: string,
): Promise<void> {
  return apiClient.delete(
    `/borgingsmomenten/${momentId}/checklist-items/${itemId}`,
    accessToken,
  );
}

export async function reorderChecklistItems(
  accessToken: string,
  momentId: string,
  input: ChecklistItemReorderInput,
): Promise<ChecklistItem[]> {
  return apiClient.post<ChecklistItem[]>(
    `/borgingsmomenten/${momentId}/checklist-items/reorder`,
    input,
    ChecklistItemListSchema,
    accessToken,
  );
}
