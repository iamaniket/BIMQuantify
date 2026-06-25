import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
