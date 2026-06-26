import { z } from 'zod';

import { DocumentStatusEnum } from '@/lib/api/schemas';

// Discipline is intentionally omitted — it's optional at creation (defaults to
// "other" server-side) and set later from the document row's inline selector.
export const DocumentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Name is required' })
    .max(255, { message: 'Max 255 characters' }),
  status: DocumentStatusEnum,
});

export type DocumentFormValues = z.infer<typeof DocumentFormSchema>;
