import { z } from 'zod';

import { apiClient } from './client';

const InstrumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  methodology_url: z.union([z.string(), z.null()]),
});

const RiskTemplateSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  default_bbl_article: z.union([z.string(), z.null()]),
});

const ChecklistItemTemplateSchema = z.object({
  code: z.string(),
  description: z.string(),
  evidence_type: z.string(),
  bbl_article_ref: z.union([z.string(), z.null()]),
  pass_fail_criteria: z.union([z.string(), z.null()]),
});

const BorgingsmomentTemplateSchema = z.object({
  code: z.string(),
  name: z.string(),
  phase: z.string(),
  default_offset_days: z.number().int(),
  checklist: z.array(ChecklistItemTemplateSchema),
});

const DossierRequirementTemplateSchema = z.object({
  code: z.string(),
  category: z.string(),
  label: z.string(),
  required: z.boolean(),
  source_kind: z.enum([
    'attachment_slot',
    'certificate_type',
    'derived',
    'model',
    'attachment_or_model',
  ]),
  source_value: z.string(),
});

export const JurisdictionSchema = z.object({
  country: z.string().length(2),
  name: z.string(),
  default_locale: z.string(),
  supported_locales: z.array(z.string()),
  frameworks: z.array(z.string()),
  postcode_pattern: z.union([z.string(), z.null()]),
  address_id_label: z.union([z.string(), z.null()]),
  building_type_labels: z.record(z.string(), z.string()),
  consequence_class_labels: z.record(z.string(), z.string()),
  status_labels: z.record(z.string(), z.string()).optional().default({}),
  phase_labels: z.record(z.string(), z.string()).optional().default({}),
  allowed_consequence_classes: z.array(z.string()),
  instruments: z.array(InstrumentSchema),
  bbl_risk_category_labels: z.record(z.string(), z.string()),
  risk_templates: z.record(z.string(), z.array(RiskTemplateSchema)),
  borgingsmoment_phase_labels: z.record(z.string(), z.string()),
  borgingsmoment_templates: z.array(BorgingsmomentTemplateSchema),
  risk_category_to_phases: z.record(z.string(), z.array(z.string())),
  dossier_requirement_templates: z
    .record(z.string(), z.array(DossierRequirementTemplateSchema))
    .optional()
    .default({}),
  dossier_category_labels: z.record(z.string(), z.string()).optional().default({}),
});

export type Jurisdiction = z.infer<typeof JurisdictionSchema>;
export type JurisdictionInstrument = z.infer<typeof InstrumentSchema>;
export type JurisdictionRiskTemplate = z.infer<typeof RiskTemplateSchema>;
export type JurisdictionBorgingsmomentTemplate = z.infer<
  typeof BorgingsmomentTemplateSchema
>;
export type JurisdictionChecklistItemTemplate = z.infer<
  typeof ChecklistItemTemplateSchema
>;
export type JurisdictionDossierRequirement = z.infer<
  typeof DossierRequirementTemplateSchema
>;

const JurisdictionListResponseSchema = z.object({
  items: z.array(JurisdictionSchema),
});

export type JurisdictionList = Jurisdiction[];

export async function listJurisdictions(
  locale?: string,
): Promise<JurisdictionList> {
  const path =
    locale === undefined
      ? '/jurisdictions'
      : `/jurisdictions?locale=${encodeURIComponent(locale)}`;
  const body = await apiClient.get(
    path,
    JurisdictionListResponseSchema,
    undefined,
  );
  return body.items as JurisdictionList;
}
