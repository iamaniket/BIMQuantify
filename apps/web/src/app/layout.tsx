import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

import { env } from '@/lib/env';

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Theme-aware favicon (follows the OS `prefers-color-scheme`, i.e. the browser chrome):
  // - favicon.svg embeds both marks and toggles via an in-SVG media query — this is what
  //   makes Chrome/Firefox switch (Chrome ignores the link `media` attribute).
  // - the light/dark PNGs cover Safari, which honors the link `media` attribute but
  //   ignores SVG favicons.
  // - favicon.ico is the plain legacy fallback (no `sizes:any`, so it can't outrank the SVG).
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-light.png', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/favicon-dark.png', type: 'image/png', media: '(prefers-color-scheme: dark)' },
      { url: '/favicon.ico', sizes: '48x48' },
    ],
    apple: { url: '/apple-icon.png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
