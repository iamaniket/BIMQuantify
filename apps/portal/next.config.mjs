import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Monorepo root. `output: 'standalone'` (below) traces the runtime file set
// from here so pnpm workspace deps (@bimdossier/*) are bundled into
// .next/standalone for containerised hosting (see apps/portal/Dockerfile).
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Security-response headers (finding B5) -------------------------------
// CSP origins are derived from env so the dynamic hosts (API, WebSocket,
// presigned storage, analytics) are configurable per environment. The CSP is
// deliberately "relaxed" — script-src allows 'unsafe-inline' (no nonce, so
// static rendering is preserved) — and leans on a tight connect-src to constrain
// token exfiltration. A stricter nonce-based policy is a tracked follow-up.
const stripSlash = (u) => (u ?? '').replace(/\/+$/, '');

const API_URL = stripSlash(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000');
// WS origin mirrors useNotificationSocket.ts (httpUrl.replace(/^http/, 'ws')):
// http→ws, https→wss. Keep the two transforms in lockstep.
const WS_URL = API_URL.replace(/^http/, 'ws');
// Presigned-storage origin (model bytes, PDF/image previews). Differs from the
// API host and is dynamic per object; CSP needs only the origin. Defaults to dev
// MinIO; MUST be set in prod or the viewer + PDF previews are CSP-blocked.
const STORAGE_URL = stripSlash(process.env.NEXT_PUBLIC_STORAGE_URL ?? 'http://localhost:9000');
const POSTHOG_HOST = stripSlash(
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
);
// PDOK (NL aerial WMS + address search) — static external origins.
const PDOK = 'https://api.pdok.nl https://service.pdok.nl';

const isProd = process.env.NODE_ENV === 'production';

// Next dev (Turbopack/webpack HMR + React Refresh) compiles via eval; prod does
// not. WASM compilation ALWAYS needs 'wasm-unsafe-eval' (web-ifc) in BOTH dev
// and prod — without it Chrome refuses to compile and the viewer dies. Do NOT
// add a nonce here: a nonce makes browsers IGNORE 'unsafe-inline', breaking
// Next's inline hydration/bootstrap scripts.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  "'wasm-unsafe-eval'",
  ...(isProd ? [] : ["'unsafe-eval'"]),
].join(' ');

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  // styled-jsx + Tailwind + the viewer's dynamic inline style={} need inline.
  "style-src 'self' 'unsafe-inline'",
  // Fragments worker (/fragments/worker.mjs) + bundled pdf.js worker
  // (/_next/static/.../*.worker.js) are same-origin; ThatOpen sometimes
  // blob-wraps the worker, hence blob:.
  "worker-src 'self' blob:",
  // System fonts only — no external CDN.
  "font-src 'self'",
  // Presigned storage JPEGs, PDOK WMS tiles, plus data:/blob: for canvas/preview.
  `img-src 'self' data: blob: ${STORAGE_URL} https://service.pdok.nl`,
  // XHR/fetch/WebSocket targets: API (REST), API WS (notifications), storage
  // (model-byte fetch), PostHog ingest, PDOK. Sentry is tunneled same-origin via
  // /monitoring, so NO Sentry ingest origin is needed here.
  `connect-src 'self' ${API_URL} ${WS_URL} ${STORAGE_URL} ${POSTHOG_HOST} ${PDOK}`,
  // PDF iframes (Attachment/Certificate/Report viewer dialogs) point at presigned
  // storage URLs; blob: covers any blob-wrapped preview.
  `frame-src 'self' ${STORAGE_URL} blob:`,
  // No one may frame the portal; <base> can't be hijacked; forms post to self.
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
      + 'encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), '
      + 'magnetometer=(), microphone=(), midi=(), payment=(), '
      + 'picture-in-picture=(), usb=()',
  },
  // HSTS only when we KNOW the deploy is https (prod, behind TLS). `next dev`
  // over http must stay clean, so gate on isProd.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (node .next/standalone/apps/portal/server.js)
  // for Docker/container hosting. `outputFileTracingRoot` = the monorepo root so
  // workspace deps are traced correctly. See apps/portal/Dockerfile.
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: 'http://localhost:8000/:path*',
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // ThatOpen ships ESM-only and pulls in three.js / web-ifc. Transpile both
  // so Next bundles them correctly for the client and avoids ESM/CJS warnings.
  transpilePackages: [
    '@bimdossier/viewer',
    '@thatopen/components',
    '@thatopen/fragments',
    'web-ifc',
  ],
  webpack: (config, { isServer }) => {
    // web-ifc.wasm is loaded at runtime from /web-ifc/. Skip bundling the
    // .wasm asset itself — it lives in public/.
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

// Pin the release to the same SHA used at runtime so uploaded source maps
// match the events Sentry receives. Fall back through common CI env vars
// (Vercel, GitHub Actions) so deploys "just work" without extra wiring.
const sentryRelease =
  process.env.SENTRY_RELEASE
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.GIT_SHA;

const sentryWebpackOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: sentryRelease ? { name: sentryRelease } : undefined,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
  reactComponentAnnotation: { enabled: true },
};

const sentryEnabled = Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);

const baseConfig = withNextIntl(nextConfig);

export default sentryEnabled ? withSentryConfig(baseConfig, sentryWebpackOptions) : baseConfig;
