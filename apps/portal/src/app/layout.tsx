import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'BIMstitch',
  description: 'BIMstitch portal — sign in to manage your projects.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
