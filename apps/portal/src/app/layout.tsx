import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'BIMstitch',
  description: 'BIMstitch portal — sign in to manage your projects.',
  applicationName: 'BIMstitch',
  appleWebApp: {
    capable: true,
    title: 'BIMstitch',
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
