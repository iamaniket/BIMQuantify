import { z } from 'zod';

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
});

export type ProjectFormValues = z.infer<typeof ProjectFormSchema>;
