import { z } from 'zod';

// Mirrors the FastAPI error envelope: { detail: string | object | array | null }.
// `detail` is parsed loosely; the client narrows it in parseErrorDetail.
export const ApiErrorBodySchema = z.object({
  detail: z.unknown(),
});
