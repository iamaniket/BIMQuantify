import { apiClient } from './client';
import {
  BorgingsmomentSchema,
  ChecklistItemResultSchema,
  ChecklistItemResultListSchema,
  InspectionSummarySchema,
  type Borgingsmoment,
  type ChecklistItemResult,
  type InspectionSummary,
  type ResultCreateInput,
} from './schemas';

export async function startInspection(
  accessToken: string,
  momentId: string,
): Promise<Borgingsmoment> {
  return apiClient.post<Borgingsmoment>(
    `/borgingsmomenten/${momentId}/start-inspection`,
    {},
    BorgingsmomentSchema,
    accessToken,
  );
}

export async function submitResult(
  accessToken: string,
  momentId: string,
  itemId: string,
  input: ResultCreateInput,
): Promise<ChecklistItemResult> {
  return apiClient.post<ChecklistItemResult>(
    `/borgingsmomenten/${momentId}/checklist-items/${itemId}/result`,
    input,
    ChecklistItemResultSchema,
    accessToken,
  );
}

export async function listResults(
  accessToken: string,
  momentId: string,
): Promise<ChecklistItemResult[]> {
  return apiClient.get<ChecklistItemResult[]>(
    `/borgingsmomenten/${momentId}/results`,
    ChecklistItemResultListSchema,
    accessToken,
  );
}

export async function getInspectionSummary(
  accessToken: string,
  momentId: string,
): Promise<InspectionSummary> {
  return apiClient.get<InspectionSummary>(
    `/borgingsmomenten/${momentId}/inspection-summary`,
    InspectionSummarySchema,
    accessToken,
  );
}

export async function completeInspection(
  accessToken: string,
  momentId: string,
): Promise<Borgingsmoment> {
  return apiClient.post<Borgingsmoment>(
    `/borgingsmomenten/${momentId}/complete-inspection`,
    {},
    BorgingsmomentSchema,
    accessToken,
  );
}
