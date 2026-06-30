/**
 * Links from the marketing site to the portal app. Registration workflows and
 * legal pages live only in the portal, so web links out to them with an
 * absolute, locale-prefixed URL (the portal uses `localePrefix: 'always'`, and
 * the locale cookie is not shared across the web↔portal origins).
 */
import { env } from '@/lib/env';

const PORTAL_BASE = env.NEXT_PUBLIC_PORTAL_URL.replace(/\/+$/, '');

/**
 * Absolute, locale-prefixed portal URL.
 * `portalHref('en', '/request-access')` -> `'http://localhost:3001/en/request-access'`.
 *
 * In standalone mode (no portal deployed) every portal link is rerouted to the
 * in-site `/coming-soon` page instead, so CTAs never dead-end. This is the single
 * choke-point for all portal links across the marketing site (header, footer,
 * hero, CTA bands, contact, etc.), so one switch reroutes them all.
 */
export function portalHref(locale: string, path: string): string {
  if (env.NEXT_PUBLIC_STANDALONE) {
    return `/${locale}/coming-soon`;
  }
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${PORTAL_BASE}/${locale}${clean}`;
}
