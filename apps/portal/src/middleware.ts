import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all paths except:
    //   - Next.js internals (_next, _vercel)
    //   - Static assets in /public served at the root (web-ifc/, fragments/, etc.)
    //   - File requests with an extension (favicon.ico, *.svg, *.wasm, *.mjs)
    '/((?!_next|_vercel|web-ifc|fragments|.*\\..*).*)',
  ],
};
