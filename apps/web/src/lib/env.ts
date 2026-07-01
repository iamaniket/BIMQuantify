/**
 * Public env vars for the marketing site. Resolved at module load time so
 * SSR / client renders see the same values.
 */
const orUndefined = (value: string | undefined): string | undefined =>
  value && value.length > 0 ? value : undefined;

/**
 * Pre-launch lock. While `true`, the site NEVER exposes an account/registration
 * funnel (login, signup, request-access) regardless of the per-flow
 * `NEXT_PUBLIC_ENABLE_*` env vars below — so no deploy can accidentally push a
 * visitor to create an account at this stage. Flip to `false` at launch; the
 * individual env flags then resume per-flow control. Typed `boolean` so the
 * `!PRELAUNCH_LOCK` branches don't read as constant conditions to linters.
 * See also `LAUNCHED` in components/sections/featureCatalog.ts (feature pages).
 */
const PRELAUNCH_LOCK: boolean = true;

export const env: Readonly<{
  NEXT_PUBLIC_API_URL: string;
  NEXT_PUBLIC_PORTAL_URL: string;
  NEXT_PUBLIC_SITE_URL: string;
  /**
   * Standalone "placeholder" mode. When `true`, the marketing site never calls
   * the backend API (the blog short-circuits to empty) and every portal-bound
   * link (Start for free, Log in, Request access, legal pages) is rerouted to an
   * in-site `/coming-soon` page instead of the portal. Lets the site ship on its
   * own domain with no API / portal running. Flip back to `false` once the
   * product is live to reconnect the API and point CTAs at the portal.
   */
  NEXT_PUBLIC_STANDALONE: boolean;
  /**
   * Pre-launch capability gates for the front-door auth CTAs. Each defaults to
   * `false` (hidden) so the marketing site reads as "in development" rather than
   * "ready to use" until the matching flow actually goes live — flip one to
   * `true` the day that flow opens (they can be enabled one at a time):
   *   - LOGIN          → header "Log in" link.
   *   - SIGNUP         → every "Start for free" CTA (header, hero, showcase, CTA band).
   *   - REQUEST_ACCESS → "Become a partner" links (footer, contact fallback).
   * Independent of `NEXT_PUBLIC_STANDALONE`, which stays the fetcher/backend switch.
   * NOTE: while the code-level `PRELAUNCH_LOCK` above is `true`, all three are
   * forced `false` here regardless of the env var — pre-launch, no account funnel
   * is exposed even if a deploy sets one of these to `true`.
   */
  NEXT_PUBLIC_ENABLE_LOGIN: boolean;
  NEXT_PUBLIC_ENABLE_SIGNUP: boolean;
  NEXT_PUBLIC_ENABLE_REQUEST_ACCESS: boolean;
  NEXT_PUBLIC_POSTHOG_KEY: string | undefined;
  NEXT_PUBLIC_POSTHOG_HOST: string;
  NEXT_PUBLIC_SOCIAL_LINKEDIN_URL: string | undefined;
  NEXT_PUBLIC_CONTACT_EMAIL: string | undefined;
  NEXT_PUBLIC_CONTACT_BOOKING_URL: string | undefined;
  /**
   * The founder/owner behind the product, surfaced as a "real person you can
   * reach" signal on the contact page and in the footer. Both must be set for
   * the founder UI to render; either blank and it self-hides.
   */
  NEXT_PUBLIC_FOUNDER_NAME: string | undefined;
  NEXT_PUBLIC_FOUNDER_LINKEDIN_URL: string | undefined;
}> = Object.freeze({
  NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
  NEXT_PUBLIC_PORTAL_URL: process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001',
  NEXT_PUBLIC_SITE_URL: process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://bimdossier.nl',
  NEXT_PUBLIC_STANDALONE: process.env['NEXT_PUBLIC_STANDALONE'] === 'true',
  NEXT_PUBLIC_ENABLE_LOGIN: !PRELAUNCH_LOCK && process.env['NEXT_PUBLIC_ENABLE_LOGIN'] === 'true',
  NEXT_PUBLIC_ENABLE_SIGNUP: !PRELAUNCH_LOCK && process.env['NEXT_PUBLIC_ENABLE_SIGNUP'] === 'true',
  NEXT_PUBLIC_ENABLE_REQUEST_ACCESS:
    !PRELAUNCH_LOCK && process.env['NEXT_PUBLIC_ENABLE_REQUEST_ACCESS'] === 'true',
  NEXT_PUBLIC_POSTHOG_KEY: process.env['NEXT_PUBLIC_POSTHOG_KEY'],
  NEXT_PUBLIC_POSTHOG_HOST: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',
  NEXT_PUBLIC_SOCIAL_LINKEDIN_URL: orUndefined(process.env['NEXT_PUBLIC_SOCIAL_LINKEDIN_URL']),
  NEXT_PUBLIC_CONTACT_EMAIL: orUndefined(process.env['NEXT_PUBLIC_CONTACT_EMAIL']),
  NEXT_PUBLIC_CONTACT_BOOKING_URL: orUndefined(process.env['NEXT_PUBLIC_CONTACT_BOOKING_URL']),
  NEXT_PUBLIC_FOUNDER_NAME: orUndefined(process.env['NEXT_PUBLIC_FOUNDER_NAME']),
  NEXT_PUBLIC_FOUNDER_LINKEDIN_URL: orUndefined(process.env['NEXT_PUBLIC_FOUNDER_LINKEDIN_URL']),
});
