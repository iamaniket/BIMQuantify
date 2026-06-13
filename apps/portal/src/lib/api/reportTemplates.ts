import { apiClient } from './client';
import {
  ReportTemplateListSchema,
  ReportTemplateSchema,
  ReportTemplateSchemaResponseSchema,
  TemplateAssetCompleteResponseSchema,
  TemplateAssetInitiateResponseSchema,
  type ReportTemplate,
  type ReportTemplateConfig,
  type ReportTemplateList,
  type ReportTemplateSchemaResponse,
  type TemplateAssetCompleteResponse,
  type TemplateAssetKind,
} from './schemas/reportTemplates';

export async function listReportTemplates(
  accessToken: string,
  reportType: string,
): Promise<ReportTemplateList> {
  return apiClient.get<ReportTemplateList>(
    `/org-templates?template_type=${encodeURIComponent(reportType)}`,
    ReportTemplateListSchema,
    accessToken,
  );
}

export async function getReportTemplateSchema(
  accessToken: string,
  reportType: string,
  locale: string,
): Promise<ReportTemplateSchemaResponse> {
  return apiClient.get<ReportTemplateSchemaResponse>(
    `/org-templates/schema?template_type=${encodeURIComponent(reportType)}&locale=${encodeURIComponent(locale)}`,
    ReportTemplateSchemaResponseSchema,
    accessToken,
  );
}

export type ReportTemplateCreateInput = {
  template_type: string;
  name: string;
  description?: string | null;
  is_default?: boolean;
  config: ReportTemplateConfig;
};

export async function createReportTemplate(
  accessToken: string,
  input: ReportTemplateCreateInput,
): Promise<ReportTemplate> {
  return apiClient.post<ReportTemplate>('/org-templates', input, ReportTemplateSchema, accessToken);
}

export type ReportTemplateUpdateInput = {
  name?: string;
  description?: string | null;
  config?: ReportTemplateConfig;
};

export async function updateReportTemplate(
  accessToken: string,
  templateId: string,
  input: ReportTemplateUpdateInput,
): Promise<ReportTemplate> {
  return apiClient.patch<ReportTemplate>(
    `/org-templates/${templateId}`,
    input,
    ReportTemplateSchema,
    accessToken,
  );
}

export async function setDefaultReportTemplate(
  accessToken: string,
  templateId: string,
): Promise<ReportTemplate> {
  return apiClient.post<ReportTemplate>(
    `/org-templates/${templateId}/set-default`,
    {},
    ReportTemplateSchema,
    accessToken,
  );
}

export async function deleteReportTemplate(accessToken: string, templateId: string): Promise<void> {
  return apiClient.delete(`/org-templates/${templateId}`, accessToken);
}

/** Two-phase presigned upload for a template asset (logo / cover PDF). Returns
 * the stored key + a presigned inline URL for preview. */
export async function uploadTemplateAssetEnd2End(
  accessToken: string,
  kind: TemplateAssetKind,
  file: File,
): Promise<TemplateAssetCompleteResponse> {
  const contentType = file.type !== '' ? file.type : 'application/octet-stream';
  const init = await apiClient.post<{ storage_key: string; upload_url: string }>(
    '/org-templates/assets/initiate',
    { asset_kind: kind, filename: file.name, content_type: contentType, size_bytes: file.size },
    TemplateAssetInitiateResponseSchema,
    accessToken,
  );
  await apiClient.putRaw(init.upload_url, file, contentType);
  return apiClient.post<TemplateAssetCompleteResponse>(
    '/org-templates/assets/complete',
    { storage_key: init.storage_key },
    TemplateAssetCompleteResponseSchema,
    accessToken,
  );
}
