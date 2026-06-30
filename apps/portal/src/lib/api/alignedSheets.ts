import { apiClient } from './client';
import { projectScope } from './scope';
import {
  AlignedSheetListSchema,
  AlignedSheetSchema,
  type AlignedSheet,
  type AlignedSheetCreateInput,
  type AlignedSheetList,
  type AlignedSheetUpdateInput,
  type CalibrateAlignedSheetInput,
} from './schemas';

/**
 * Aligned-sheets API, free/paid unified via the `free` flag (`scope.ts`).
 *
 * Both tiers return the SAME `AlignedSheetSchema`. The only divergences the flag
 * encodes: the free backend references the PDF page by `page_number` (1-based)
 * rather than the paid `page_index` (0-based) + `page_id` FK — so create/update
 * convert `page_index → page_number` for free — and the free list endpoint takes
 * no server-side filters (the caller filters the small result client-side).
 */

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

const base = (projectId: string, free: boolean): string =>
  `${projectScope(projectId, free)}/aligned-sheets`;

// Free references the PDF page by 1-based `page_number`; paid sends `page_index`
// (0-based) + `page_id` through as-is.
function createBody(input: AlignedSheetCreateInput, free: boolean): Record<string, unknown> {
  if (!free) return input;
  return {
    document_id: input.document_id,
    level_id: input.level_id,
    pdf_document_id: input.pdf_document_id,
    page_number: (input.page_index ?? 0) + 1,
  };
}

function updateBody(input: AlignedSheetUpdateInput, free: boolean): Record<string, unknown> {
  if (!free) return input;
  const body: Record<string, unknown> = {};
  if (input.level_id !== undefined) body['level_id'] = input.level_id;
  if (input.page_index !== undefined) body['page_number'] = input.page_index + 1;
  return body;
}

export async function listAlignedSheets(
  accessToken: string,
  projectId: string,
  filters: AlignedSheetFilters = {},
  free = false,
): Promise<AlignedSheetList> {
  // Free takes no server-side filters — the caller filters the small list client-side.
  const qs = free ? '' : buildQuery(filters);
  return apiClient.get<AlignedSheetList>(
    `${base(projectId, free)}${qs}`,
    AlignedSheetListSchema,
    accessToken,
  );
}

export async function getAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  free = false,
): Promise<AlignedSheet> {
  return apiClient.get<AlignedSheet>(
    `${base(projectId, free)}/${sheetId}`,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function createAlignedSheet(
  accessToken: string,
  projectId: string,
  input: AlignedSheetCreateInput,
  free = false,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    base(projectId, free),
    createBody(input, free),
    AlignedSheetSchema,
    accessToken,
  );
}

export async function updateAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: AlignedSheetUpdateInput,
  free = false,
): Promise<AlignedSheet> {
  return apiClient.patch<AlignedSheet>(
    `${base(projectId, free)}/${sheetId}`,
    updateBody(input, free),
    AlignedSheetSchema,
    accessToken,
  );
}

export async function calibrateAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: CalibrateAlignedSheetInput,
  free = false,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    `${base(projectId, free)}/${sheetId}/calibrate`,
    input,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function deleteAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  free = false,
): Promise<void> {
  return apiClient.delete(`${base(projectId, free)}/${sheetId}`, accessToken);
}
