import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Registration (request-access) and legal pages live only in the portal. Old
// web URLs are forwarded there so bookmarks, search results, and any stray
// links keep working. Temporary (307) during beta — switch to permanent: true
// once the move is final to pass link equity.
const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

// Standalone "placeholder" mode (no portal deployed): forward the portal-only
// routes to the in-site /coming-soon page instead of a dead portal origin.
const STANDALONE = process.env.NEXT_PUBLIC_STANDALONE === 'true';

// --- Security-response headers (finding B5) -------------------------------
// The marketing site has no viewer/WASM/worker — a much smaller CSP than the
// portal. Only Next itself + PostHog analytics. Relaxed (script-src
// 'unsafe-inline', no nonce) to preserve static rendering.
const stripSlash = (u) => (u ?? '').replace(/\/+$/, '');
const POSTHOG_HOST = stripSlash(
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
);
// Presigned-storage origin for API-published blog cover images (served from
// MinIO/S3 as absolute http(s) URLs, rendered as a plain <img> — see
// RemoteOrLocalImage). The browser enforces img-src against this origin, so it
// MUST match the host in S3_PUBLIC_ENDPOINT_URL the API signs with (e.g. a LAN
// IP for on-device dev), or covers are CSP-blocked. Defaults to dev MinIO.
const STORAGE_URL = stripSlash(process.env.NEXT_PUBLIC_STORAGE_URL ?? 'http://localhost:9000');
const isProd = process.env.NODE_ENV === 'production';

// Next dev (HMR/React Refresh) compiles via eval; prod does not.
const scriptSrc = ["'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"])].join(' ');

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // Blog cover images are presigned MinIO/S3 URLs (RemoteOrLocalImage <img>).
  `img-src 'self' data: blob: ${STORAGE_URL}`,
  `connect-src 'self' ${POSTHOG_HOST}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), autoplay=(), camera=(), display-capture=(), '
      + 'encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), '
      + 'magnetometer=(), microphone=(), midi=(), payment=(), '
      + 'picture-in-picture=(), usb=()',
  },
  // HSTS only when we KNOW the deploy is https (prod). `next dev` over http
  // must stay clean, so gate on isProd.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    if (STANDALONE) {
      return [
        {
          source: '/:locale/request-access',
          destination: '/:locale/coming-soon',
          permanent: false,
        },
        {
          source: '/:locale/legal/:path*',
          destination: '/:locale/coming-soon',
          permanent: false,
        },
      ];
    }
    return [
      {
        source: '/:locale/request-access',
        destination: `${PORTAL_URL}/:locale/request-access`,
        permanent: false,
      },
      {
        source: '/:locale/legal/:path*',
        destination: `${PORTAL_URL}/:locale/legal/:path*`,
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
