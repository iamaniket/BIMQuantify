import { z } from 'zod';

export const ContractorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kvk_number: z.union([z.string(), z.null()]),
  contact_email: z.union([z.string(), z.null()]),
  contact_phone: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Contractor = z.infer<typeof ContractorSchema>;

export const ContractorListSchema = z.array(ContractorSchema);

export type ContractorList = z.infer<typeof ContractorListSchema>;

export const ContractorCreateSchema = z.object({
  name: z.string().min(1).max(255),
  kvk_number: z.union([z.string().max(20), z.null()]).optional(),
  contact_email: z.union([z.string().max(320), z.null()]).optional(),
  contact_phone: z.union([z.string().max(50), z.null()]).optional(),
});

export type ContractorCreateInput = z.infer<typeof ContractorCreateSchema>;

export const ContractorUpdateSchema = ContractorCreateSchema.partial();

export type ContractorUpdateInput = z.infer<typeof ContractorUpdateSchema>;
