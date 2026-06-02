import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'BimDossier',
  description: 'BimDossier portal — sign in to manage your projects.',
  applicationName: 'BimDossier',
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
