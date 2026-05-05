import { z } from 'zod';

export const ApiErrorBodySchema = z.object({
  detail: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
