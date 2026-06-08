import { apiClient } from './client';
import {
  FindingTemplateListSchema,
  FindingTemplateSchema,
  type FindingTemplate,
  type FindingTemplateCreateInput,
  type FindingTemplateList,
  type FindingTemplateUpdateInput,
} from './schemas';

export async function listFindingTemplates(
  accessToken: string,
  templateType = 'findings',
): Promise<FindingTemplateList> {
  const params = new URLSearchParams();
  if (templateType.length > 0) params.set('template_type', templateType);
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<FindingTemplateList>(
    `/finding-templates${query}`,
    FindingTemplateListSchema,
    accessToken,
  );
}

export async function getFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<FindingTemplate> {
  return apiClient.get<FindingTemplate>(
    `/finding-templates/${templateId}`,
    FindingTemplateSchema,
    accessToken,
  );
}

export async function createFindingTemplate(
  accessToken: string,
  input: FindingTemplateCreateInput,
): Promise<FindingTemplate> {
  return apiClient.post<FindingTemplate>(
    '/finding-templates',
    input,
    FindingTemplateSchema,
    accessToken,
  );
}

export async function updateFindingTemplate(
  accessToken: string,
  templateId: string,
  input: FindingTemplateUpdateInput,
): Promise<FindingTemplate> {
  return apiClient.patch<FindingTemplate>(
    `/finding-templates/${templateId}`,
    input,
    FindingTemplateSchema,
    accessToken,
  );
}

export async function setDefaultFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<FindingTemplate> {
  return apiClient.post<FindingTemplate>(
    `/finding-templates/${templateId}/set-default`,
    {},
    FindingTemplateSchema,
    accessToken,
  );
}

export async function deleteFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<void> {
  return apiClient.delete(`/finding-templates/${templateId}`, accessToken);
}
