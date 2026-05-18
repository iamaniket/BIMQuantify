import { z } from 'zod';

export const RiskCategoryEnum = z.enum([
  'structural_safety',
  'fire_safety',
  'health',
  'energy_efficiency',
  'usability',
]);

export type RiskCategoryValue = z.infer<typeof RiskCategoryEnum>;

export const RiskLevelEnum = z.enum(['low', 'medium', 'high']);

export type RiskLevelValue = z.infer<typeof RiskLevelEnum>;

export const RiskSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  category: RiskCategoryEnum,
  level: RiskLevelEnum,
  description: z.string(),
  mitigation: z.string(),
  responsible_party: z.union([z.string(), z.null()]),
  bbl_article_ref: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Risk = z.infer<typeof RiskSchema>;

export const RiskListSchema = z.array(RiskSchema);

export type RiskList = z.infer<typeof RiskListSchema>;

export const RiskCreateSchema = z.object({
  category: RiskCategoryEnum,
  level: RiskLevelEnum,
  description: z.string().trim().min(1, { message: 'Beschrijving is verplicht' }).max(2000),
  mitigation: z.string().trim().min(1, { message: 'Beheersmaatregel is verplicht' }).max(2000),
  responsible_party: z
    .union([z.string().max(255), z.null()])
    .optional(),
  bbl_article_ref: z
    .union([z.string().max(50), z.null()])
    .optional(),
});

export type RiskCreateInput = z.infer<typeof RiskCreateSchema>;

export const RiskUpdateSchema = RiskCreateSchema.partial();

export type RiskUpdateInput = z.infer<typeof RiskUpdateSchema>;
