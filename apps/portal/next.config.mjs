import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // ThatOpen ships ESM-only and pulls in three.js / web-ifc. Transpile both
  // so Next bundles them correctly for the client and avoids ESM/CJS warnings.
  transpilePackages: [
    '@bimstitch/viewer',
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

const sentryWebpackOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
  reactComponentAnnotation: { enabled: true },
};

const sentryEnabled = Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);

const baseConfig = withNextIntl(nextConfig);

export default sentryEnabled ? withSentryConfig(baseConfig, sentryWebpackOptions) : baseConfig;
