import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

import { env } from '@/lib/env';

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
