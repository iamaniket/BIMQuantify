import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_MARKETING_URL: z.string().url().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url(),
  // Set to '1' by the Playwright E2E webServer (see playwright.config.ts) to
  // opt the portal into test-only behaviour — currently disabling the
  // post-login notifications WebSocket so the dashboard page goes idle.
  NEXT_PUBLIC_E2E: z.string().optional(),
});

// Dev convenience only. In production a missing NEXT_PUBLIC_API_URL must fail
// the build via the Zod `.url()` requirement, rather than silently pointing the
// client at localhost. (POSTHOG_HOST keeps its public default — eu.i.posthog.com
// is a valid prod endpoint, not a dev-only value, and is unused without a key.)
const isDev = process.env.NODE_ENV !== 'production';

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_API_URL:
    process.env['NEXT_PUBLIC_API_URL'] ?? (isDev ? 'http://localhost:8000' : undefined),
  NEXT_PUBLIC_MARKETING_URL: process.env['NEXT_PUBLIC_MARKETING_URL'],
  NEXT_PUBLIC_POSTHOG_KEY: process.env['NEXT_PUBLIC_POSTHOG_KEY'],
  NEXT_PUBLIC_POSTHOG_HOST: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',
  NEXT_PUBLIC_E2E: process.env['NEXT_PUBLIC_E2E'],
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
  NEXT_PUBLIC_E2E?: string | undefined;
}> = Object.freeze(parsed.data);
/* eslint-enable no-restricted-syntax */
