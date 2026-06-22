import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'BimDossier',
  description: 'BimDossier portal — sign in to manage your projects.',
  applicationName: 'BimDossier',
  // Theme-aware favicon (follows the OS `prefers-color-scheme`): favicon.svg embeds both
  // marks and toggles via an in-SVG media query (makes Chrome/Firefox switch — Chrome
  // ignores the link `media` attribute); the light/dark PNGs cover Safari (honors `media`,
  // ignores SVG favicons); favicon.ico is the legacy fallback. PWA install icons: manifest.ts.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-light.png', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/favicon-dark.png', type: 'image/png', media: '(prefers-color-scheme: dark)' },
      { url: '/favicon.ico', sizes: '48x48' },
    ],
    apple: { url: '/apple-icon.png', sizes: '180x180' },
  },
  appleWebApp: {
    capable: true,
    title: 'BimDossier',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#2c5697',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
