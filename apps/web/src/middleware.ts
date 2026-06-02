import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all paths except:
    //   - Next.js internals (_next, _vercel)
    //   - Metadata routes (apple-icon, icon, sitemap, robots, feed.xml) — locale-agnostic
    //   - File requests with an extension (favicon.ico, *.svg, *.png, etc.)
    '/((?!_next|_vercel|apple-icon|icon|sitemap|robots|feed\\.xml|.*\\..*).*)',
  ],
};
