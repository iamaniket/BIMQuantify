import { z } from 'zod';

// Report-kind template types (the report types that support branded templates).
export const REPORT_TEMPLATE_TYPES = [
  'compliance_report',
  'assurance_plan',
  'completion_declaration',
  'dossier',
] as const;
export const ReportTemplateTypeEnum = z.enum(REPORT_TEMPLATE_TYPES);
export type ReportTemplateType = z.infer<typeof ReportTemplateTypeEnum>;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Read schemas are lenient (the API already validated on write).
export const ReportBrandingSchema = z.object({
  logo_storage_key: z.string().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  accent_color_secondary: z.string().nullable().optional(),
  header_text: z.string().nullable().optional(),
  footer_text: z.string().nullable().optional(),
  cover_pdf_storage_key: z.string().nullable().optional(),
});
export type ReportBranding = z.infer<typeof ReportBrandingSchema>;

// NOTE: response schemas avoid `.default()` so input == output and the schema
// stays assignable to `apiClient`'s `ZodType<T>` param. The API always emits
// these keys (its pydantic dump keeps the non-null defaults).
export const ReportContentSectionSchema = z.object({
  type: z.literal('content'),
  key: z.string(),
  enabled: z.boolean(),
  title_override: z.string().nullable().optional(),
});
export const ReportTextSectionSchema = z.object({
  type: z.literal('text'),
  id: z.string(),
  title: z.string().nullable().optional(),
  body: z.string(),
  enabled: z.boolean(),
});
export const ReportSectionSchema = z.discriminatedUnion('type', [
  ReportContentSectionSchema,
  ReportTextSectionSchema,
]);
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const ReportOptionsSchema = z.object({
  signature_label: z.string().nullable().optional(),
  show_toc: z.boolean(),
});

export const ReportTemplateConfigSchema = z.object({
  branding: ReportBrandingSchema,
  sections: z.array(ReportSectionSchema),
  options: ReportOptionsSchema,
});
export type ReportTemplateConfig = z.infer<typeof ReportTemplateConfigSchema>;

export const ReportTemplateSchema = z.object({
  id: z.string().uuid(),
  template_type: z.string(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  is_default: z.boolean(),
  config: ReportTemplateConfigSchema,
  created_by_user_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

export const ReportTemplateListSchema = z.array(ReportTemplateSchema);
export type ReportTemplateList = z.infer<typeof ReportTemplateListSchema>;

// GET /org-templates/schema — the builder's available sections + merge fields.
export const ReportTemplateSchemaResponseSchema = z.object({
  template_type: z.string(),
  sections: z.array(z.object({ key: z.string(), label: z.string() })),
  merge_fields: z.array(z.object({ path: z.string(), label: z.string() })),
});
export type ReportTemplateSchemaResponse = z.infer<typeof ReportTemplateSchemaResponseSchema>;

// Asset upload (logo / cover PDF).
export const TEMPLATE_ASSET_KINDS = ['logo', 'cover_pdf'] as const;
export const TemplateAssetKindEnum = z.enum(TEMPLATE_ASSET_KINDS);
export type TemplateAssetKind = z.infer<typeof TemplateAssetKindEnum>;

export const TemplateAssetInitiateResponseSchema = z.object({
  storage_key: z.string(),
  upload_url: z.string(),
});
export const TemplateAssetCompleteResponseSchema = z.object({
  storage_key: z.string(),
  url: z.string(),
});
export type TemplateAssetCompleteResponse = z.infer<typeof TemplateAssetCompleteResponseSchema>;
