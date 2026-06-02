import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://bimdossier.nl';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
