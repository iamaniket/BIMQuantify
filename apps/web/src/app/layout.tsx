import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import type { JSX, ReactNode } from 'react';

import { Header } from '@/components/Header';
import { ThemeProvider } from '@/providers/ThemeProvider';

import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BIMstitch',
  description: 'AI-based BIM takeoff platform supporting IFC and BCF',
};

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props): JSX.Element {
  return (
    <html lang="en" className={fraunces.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <div className="flex-1">{children}</div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
