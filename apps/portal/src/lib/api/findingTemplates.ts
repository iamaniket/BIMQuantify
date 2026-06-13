import { z } from 'zod';

import { apiClient } from './client';
import {
  BuiltinFieldsSchema,
  FieldDefSchema,
  FindingTemplateSchema,
  type FindingTemplate,
  type FindingTemplateCreateInput,
  type FindingTemplateList,
  type FindingTemplateUpdateInput,
} from './schemas';

// Findings templates live in the unified `/org-templates` table, with the
// finding-form definition nested under `config`. This client adapts that wire
// shape to the flat `FindingTemplate` the finding UI consumes, so the
// finding-template components are unchanged after the table unification.
const OrgTemplateApiSchema = z.object({
  id: z.string().uuid(),
  template_type: z.string(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  is_default: z.boolean(),
  config: z
    .object({
      builtin_fields: BuiltinFieldsSchema.optional(),
      fields: z.array(FieldDefSchema).optional(),
    })
    .passthrough(),
  created_by_user_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
type OrgTemplateApi = z.infer<typeof OrgTemplateApiSchema>;

function toFindingTemplate(row: OrgTemplateApi): FindingTemplate {
  return FindingTemplateSchema.parse({
    id: row.id,
    template_type: row.template_type,
    name: row.name,
    description: row.description,
    is_default: row.is_default,
    builtin_fields: row.config.builtin_fields ?? {},
    fields: row.config.fields ?? [],
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export async function listFindingTemplates(
  accessToken: string,
  templateType = 'findings',
): Promise<FindingTemplateList> {
  const rows = await apiClient.get<OrgTemplateApi[]>(
    `/org-templates?template_type=${encodeURIComponent(templateType)}`,
    z.array(OrgTemplateApiSchema),
    accessToken,
  );
  return rows.map(toFindingTemplate);
}

export async function getFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<FindingTemplate> {
  const row = await apiClient.get<OrgTemplateApi>(
    `/org-templates/${templateId}`,
    OrgTemplateApiSchema,
    accessToken,
  );
  return toFindingTemplate(row);
}

export async function createFindingTemplate(
  accessToken: string,
  input: FindingTemplateCreateInput,
): Promise<FindingTemplate> {
  const body = {
    template_type: 'findings',
    name: input.name,
    description: input.description ?? null,
    is_default: input.is_default ?? false,
    config: { builtin_fields: input.builtin_fields, fields: input.fields },
  };
  const row = await apiClient.post<OrgTemplateApi>(
    '/org-templates',
    body,
    OrgTemplateApiSchema,
    accessToken,
  );
  return toFindingTemplate(row);
}

export async function updateFindingTemplate(
  accessToken: string,
  templateId: string,
  input: FindingTemplateUpdateInput,
): Promise<FindingTemplate> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body['name'] = input.name;
  if (input.description !== undefined) body['description'] = input.description;
  // The builder always sends the full field set on edit, so a `config` here is a
  // complete replacement (never a partial that could drop the other sub-key).
  if (input.builtin_fields !== undefined || input.fields !== undefined) {
    body['config'] = {
      builtin_fields: input.builtin_fields ?? {},
      fields: input.fields ?? [],
    };
  }
  const row = await apiClient.patch<OrgTemplateApi>(
    `/org-templates/${templateId}`,
    body,
    OrgTemplateApiSchema,
    accessToken,
  );
  return toFindingTemplate(row);
}

export async function setDefaultFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<FindingTemplate> {
  const row = await apiClient.post<OrgTemplateApi>(
    `/org-templates/${templateId}/set-default`,
    {},
    OrgTemplateApiSchema,
    accessToken,
  );
  return toFindingTemplate(row);
}

export async function deleteFindingTemplate(
  accessToken: string,
  templateId: string,
): Promise<void> {
  return apiClient.delete(`/org-templates/${templateId}`, accessToken);
}
