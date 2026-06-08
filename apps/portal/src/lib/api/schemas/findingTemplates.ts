import { z } from 'zod';

// Custom field types supported by the v1 builder. Mirrors the API
// `FindingFieldType` StrEnum.
export const FINDING_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
] as const;
export const FindingFieldTypeEnum = z.enum(FINDING_FIELD_TYPES);
export type FindingFieldTypeValue = z.infer<typeof FindingFieldTypeEnum>;

// Forward-compat discriminator. New kinds are added here AND in the API enum.
export const TEMPLATE_TYPES = ['findings'] as const;
export const TemplateTypeEnum = z.enum(TEMPLATE_TYPES);
export type TemplateTypeValue = z.infer<typeof TemplateTypeEnum>;

// UX guardrails — kept in sync with MAX_TEMPLATE_FIELDS in the API config.
export const MAX_TEMPLATE_FIELDS = 30;
export const MAX_SELECT_OPTIONS = 50;
export const FIELD_ID_PATTERN = /^f_[a-z0-9]{4,12}$/;

// Built-in finding fields a template may toggle. Never includes
// status/assignee/deadline/resolution (the lifecycle owns those).
export const TEMPLATABLE_BUILTINS = [
  'severity',
  'bbl_article_ref',
  'photos',
  'references',
] as const;
export type TemplatableBuiltin = (typeof TEMPLATABLE_BUILTINS)[number];

export const FieldDefSchema = z
  .object({
    id: z.string().regex(FIELD_ID_PATTERN),
    type: FindingFieldTypeEnum,
    label: z.string().min(1).max(120),
    required: z.boolean(),
    help_text: z.union([z.string().max(300), z.null()]).optional(),
    options: z.array(z.string()).nullable().optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select') {
      const opts = field.options ?? [];
      if (opts.length < 1 || opts.length > MAX_SELECT_OPTIONS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SELECT_FIELD_NEEDS_OPTIONS', path: ['options'] });
      }
      const trimmed = opts.map((o) => o.trim());
      if (trimmed.some((o) => o.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SELECT_OPTION_EMPTY', path: ['options'] });
      }
      if (new Set(trimmed).size !== trimmed.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SELECT_OPTIONS_NOT_UNIQUE', path: ['options'] });
      }
    } else if (field.options != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'OPTIONS_ONLY_FOR_SELECT', path: ['options'] });
    }
    if (field.type !== 'number' && (field.min != null || field.max != null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MINMAX_ONLY_FOR_NUMBER', path: ['min'] });
    }
    if (field.min != null && field.max != null && field.max < field.min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MIN_GREATER_THAN_MAX', path: ['max'] });
    }
  });
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const BuiltinFieldConfigSchema = z.object({
  visible: z.boolean(),
  required: z.boolean(),
});
export type BuiltinFieldConfig = z.infer<typeof BuiltinFieldConfigSchema>;

export const BuiltinFieldsSchema = z.record(z.string(), BuiltinFieldConfigSchema);
export type BuiltinFields = z.infer<typeof BuiltinFieldsSchema>;

export const FindingTemplateSchema = z.object({
  id: z.string().uuid(),
  template_type: z.string(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  is_default: z.boolean(),
  builtin_fields: BuiltinFieldsSchema,
  fields: z.array(FieldDefSchema),
  created_by_user_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FindingTemplate = z.infer<typeof FindingTemplateSchema>;

export const FindingTemplateListSchema = z.array(FindingTemplateSchema);
export type FindingTemplateList = z.infer<typeof FindingTemplateListSchema>;

export const FindingTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.union([z.string().max(2000), z.null()]).optional(),
  builtin_fields: BuiltinFieldsSchema.default({}),
  fields: z.array(FieldDefSchema).max(MAX_TEMPLATE_FIELDS).default([]),
  is_default: z.boolean().default(false),
});
export type FindingTemplateCreateInput = z.infer<typeof FindingTemplateCreateSchema>;

export const FindingTemplateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.union([z.string().max(2000), z.null()]).optional(),
  builtin_fields: BuiltinFieldsSchema.optional(),
  fields: z.array(FieldDefSchema).max(MAX_TEMPLATE_FIELDS).optional(),
});
export type FindingTemplateUpdateInput = z.infer<typeof FindingTemplateUpdateSchema>;

// Answer snapshot stored on a finding ({fieldId: {label, type, value}}).
export const CustomValuesSnapshotSchema = z.record(
  z.string(),
  z.object({ label: z.string(), type: z.string(), value: z.unknown() }),
);
export type CustomValuesSnapshot = z.infer<typeof CustomValuesSnapshotSchema>;
