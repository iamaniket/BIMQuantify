import { z } from 'zod';

import { ModelDisciplineEnum, ModelStatusEnum } from '@/lib/api/schemas';

export const ModelFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Name is required' })
    .max(255, { message: 'Max 255 characters' }),
  discipline: ModelDisciplineEnum,
  status: ModelStatusEnum,
});

export type ModelFormValues = z.infer<typeof ModelFormSchema>;
