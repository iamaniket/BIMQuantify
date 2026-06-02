import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_MARKETING_URL: z.string().url().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url(),
});

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
  NEXT_PUBLIC_MARKETING_URL: process.env['NEXT_PUBLIC_MARKETING_URL'],
  NEXT_PUBLIC_POSTHOG_KEY: process.env['NEXT_PUBLIC_POSTHOG_KEY'],
  NEXT_PUBLIC_POSTHOG_HOST: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
  );
}

/* eslint-disable no-restricted-syntax -- Zod's `.optional()` produces an
   optional-key shape; under exactOptionalPropertyTypes the surface type must
   match `?:` exactly. */
export const env: Readonly<{
  NEXT_PUBLIC_API_URL: string;
  NEXT_PUBLIC_MARKETING_URL?: string | undefined;
  NEXT_PUBLIC_POSTHOG_KEY?: string | undefined;
  NEXT_PUBLIC_POSTHOG_HOST: string;
}> = Object.freeze(parsed.data);
/* eslint-enable no-restricted-syntax */
