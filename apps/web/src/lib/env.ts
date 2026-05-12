/**
 * Public env vars for the marketing site. Resolved at module load time so
 * SSR / client renders see the same values.
 */
export const env: Readonly<{
  NEXT_PUBLIC_API_URL: string;
  NEXT_PUBLIC_PORTAL_URL: string;
}> = Object.freeze({
  NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
  NEXT_PUBLIC_PORTAL_URL: process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001',
});
