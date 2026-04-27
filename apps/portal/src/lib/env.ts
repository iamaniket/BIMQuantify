import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
  );
}

export const env: Readonly<{ NEXT_PUBLIC_API_URL: string }> = Object.freeze(parsed.data);
