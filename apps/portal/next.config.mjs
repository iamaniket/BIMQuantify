import createNextIntlPlugin from 'next-intl/plugin';

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

export default withNextIntl(nextConfig);
