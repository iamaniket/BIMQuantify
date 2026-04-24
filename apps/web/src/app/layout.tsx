import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { AuthProvider } from '@/providers/AuthProvider';
import { QueryProvider } from '@/providers/QueryProvider';

import './globals.css';

export const metadata: Metadata = {
  title: 'BIMQuantify',
  description: 'AI-based BIM takeoff platform supporting IFC and BCF',
};

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
