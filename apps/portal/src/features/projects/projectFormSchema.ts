import { z } from 'zod';

import { ProjectPhaseEnum, ProjectStatusEnum } from '@/lib/api/schemas';

const optionalTrimmedString = (max: number): z.ZodOptional<z.ZodString> =>
  z.string().trim().max(max).optional();

export const ProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Name is required' })
    .max(255, { message: 'Max 255 characters' }),
  description: z
    .string()
    .trim()
    .max(2000, { message: 'Description is too long' })
    .optional(),

  // Project metadata
  reference_code: optionalTrimmedString(50),
  status: ProjectStatusEnum.optional(),
  phase: ProjectPhaseEnum.optional(),
  delivery_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' })
    .optional()
    .or(z.literal('')),

  // Address
  street: optionalTrimmedString(255),
  house_number: optionalTrimmedString(20),
  postal_code: z
    .string()
    .trim()
    .regex(/^\d{4}\s?[A-Za-z]{2}$/, { message: 'Use 1234 AB format' })
    .optional()
    .or(z.literal('')),
  city: optionalTrimmedString(255),
  municipality: optionalTrimmedString(255),
  permit_number: optionalTrimmedString(100),

  bag_id: optionalTrimmedString(50),
  // Stored as numbers — kept on the form so they survive a re-render after
  // address lookup auto-populates them. Hidden inputs in the dialog hold them.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),

  contractor_id: z.string().uuid().optional().or(z.literal('')),
});

export type ProjectFormValues = z.infer<typeof ProjectFormSchema>;
