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

/**
 * Free-tier aligned-sheets API — the org-less analogue of `lib/api/alignedSheets.ts`.
 *
 * The free backend references the PDF page by `page_number` (1-based) rather than
 * the paid `page_index` (0-based) + `page_id` FK, so create/update convert
 * `page_index → page_number`. Responses parse with the SAME `AlignedSheetSchema`
 * (its `page_id` is nullable; free omits it). The free list takes no server-side
 * filters — the caller filters the (small) result client-side, as the paid
 * CalibrationPane already does.
 */

const base = (projectId: string): string => `/free/projects/${projectId}/aligned-sheets`;

export async function listFreeAlignedSheets(
  accessToken: string,
  projectId: string,
): Promise<AlignedSheetList> {
  return apiClient.get<AlignedSheetList>(base(projectId), AlignedSheetListSchema, accessToken);
}

export async function createFreeAlignedSheet(
  accessToken: string,
  projectId: string,
  input: AlignedSheetCreateInput,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    base(projectId),
    {
      document_id: input.document_id,
      level_id: input.level_id,
      pdf_document_id: input.pdf_document_id,
      page_number: (input.page_index ?? 0) + 1,
    },
    AlignedSheetSchema,
    accessToken,
  );
}

export async function updateFreeAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: AlignedSheetUpdateInput,
): Promise<AlignedSheet> {
  const body: Record<string, unknown> = {};
  if (input.level_id !== undefined) body['level_id'] = input.level_id;
  if (input.page_index !== undefined) body['page_number'] = input.page_index + 1;
  return apiClient.patch<AlignedSheet>(
    `${base(projectId)}/${sheetId}`,
    body,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function calibrateFreeAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
  input: CalibrateAlignedSheetInput,
): Promise<AlignedSheet> {
  return apiClient.post<AlignedSheet>(
    `${base(projectId)}/${sheetId}/calibrate`,
    input,
    AlignedSheetSchema,
    accessToken,
  );
}

export async function deleteFreeAlignedSheet(
  accessToken: string,
  projectId: string,
  sheetId: string,
): Promise<void> {
  return apiClient.delete(`${base(projectId)}/${sheetId}`, accessToken);
}
