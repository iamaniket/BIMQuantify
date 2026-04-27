import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { Header } from '@/components/Header';
import { AuthProvider } from '@/providers/AuthProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

import './globals.css';

export const metadata: Metadata = {
  title: 'BIMstitch',
  description: 'BIMstitch portal — sign in to manage your projects.',
};

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <div className="flex min-h-screen flex-col">
                <Header />
                <div className="flex-1">{children}</div>
              </div>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
