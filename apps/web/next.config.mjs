import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Registration (request-access) and legal pages live only in the portal. Old
// web URLs are forwarded there so bookmarks, search results, and any stray
// links keep working. Temporary (307) during beta — switch to permanent: true
// once the move is final to pass link equity.
const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  async redirects() {
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
