import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import type { JSX, ReactNode } from 'react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { LocaleProvider } from '@/providers/LocaleProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  display: 'swap',
});

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://bimdossier.nl';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'BimDossier — Wkb-compliant digitaal dossier',
    template: '%s — BimDossier',
  },
  description:
    'Wkb-compliant digital dossier for Dutch contractors. Track deadlines, manage documents, resolve findings, and file on time.',
  openGraph: {
    type: 'website',
    siteName: 'BimDossier',
    title: 'BimDossier — Wkb-compliant digitaal dossier',
    description:
      'Track bouwmelding and gereedmelding deadlines, manage your Wkb dossier, resolve findings, and file on time.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BimDossier',
    description:
      'Wkb-compliant digital dossier for Dutch contractors.',
  },
  alternates: {
    types: {
      'application/rss+xml': '/feed.xml',
    },
  },
};

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props): JSX.Element {
  return (
    <html lang="nl" className={fraunces.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <LocaleProvider>
            <div className="flex min-h-screen flex-col">
              <Header />
              <div className="flex-1">{children}</div>
              <Footer />
            </div>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
