/**
 * Public env vars for the marketing site. Resolved at module load time so
 * SSR / client renders see the same values.
 */
export const env: Readonly<{
  NEXT_PUBLIC_API_URL: string;
  NEXT_PUBLIC_PORTAL_URL: string;
  NEXT_PUBLIC_POSTHOG_KEY: string | undefined;
  NEXT_PUBLIC_POSTHOG_HOST: string;
}> = Object.freeze({
  NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
  NEXT_PUBLIC_PORTAL_URL: process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001',
  NEXT_PUBLIC_POSTHOG_KEY: process.env['NEXT_PUBLIC_POSTHOG_KEY'],
  NEXT_PUBLIC_POSTHOG_HOST: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',
});
