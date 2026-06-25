import { apiClient } from './client';
import {
  AlignedSheetListSchema,
  AlignedSheetSchema,
  type AlignedSheet,
  type AlignedSheetCreateInput,
  type AlignedSheetList,
  type AlignedSheetUpdateInput,
  type CalibrateAlignedSheetInput,
} from './schemas';

export type AlignedSheetFilters = {
  modelId?: string;
  levelId?: string;
  pdfModelId?: string;
};

function buildQuery(filters: AlignedSheetFilters): string {
  const params = new URLSearchParams();
  if (filters.modelId !== undefined) params.set('document_id', filters.modelId);
  if (filters.levelId !== undefined) params.set('level_id', filters.levelId);
  if (filters.pdfModelId !== undefined) params.set('pdf_document_id', filters.pdfModelId);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export async function listAlignedSheets(
  accessToken: string,
  projectId: string,
  filters: AlignedSheetFilters = {},
): Promise<AlignedSheetList> {
  return apiClient.get<AlignedSheetList>(
    `/projects/${projectId}/aligned-sheets${buildQuery(filters)}`,
    AlignedSheetListSchema,
    accessToken,
  );
}

export async function getAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
): Promise<AlignedSheet> {
  return apiClient.get<AlignedSheet>(
    `/projects/${projectId}/aligned-sheets/${sheetId}`,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function createAlignedSheet(
  accessToken: string,
  projectId: string,
  input: AlignedSheetCreateInput,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    `/projects/${projectId}/aligned-sheets`,
    input,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function updateAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: AlignedSheetUpdateInput,
): Promise<AlignedSheet> {
  return apiClient.patch<AlignedSheet>(
    `/projects/${projectId}/aligned-sheets/${sheetId}`,
    input,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function calibrateAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: CalibrateAlignedSheetInput,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    `/projects/${projectId}/aligned-sheets/${sheetId}/calibrate`,
    input,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function deleteAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
): Promise<void> {
  return apiClient.delete(
    `/projects/${projectId}/aligned-sheets/${sheetId}`,
    accessToken,
  );
}
