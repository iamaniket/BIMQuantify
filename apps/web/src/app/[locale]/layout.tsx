import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Fraunces } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import '../globals.css';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { PostHogProvider } from '@/providers/PostHogProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    title: {
      default: t('defaultTitle'),
      template: '%s · BimDossier',
    },
    description: t('description'),
    openGraph: {
      type: 'website',
      siteName: 'BimDossier',
      title: t('defaultTitle'),
      description: t('description'),
      locale: locale === 'nl' ? 'nl_NL' : 'en_US',
      alternateLocale: locale === 'nl' ? ['en_US'] : ['nl_NL'],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
    // Theme-aware favicon (follows the OS `prefers-color-scheme`, i.e. the browser chrome):
    // - favicon.svg embeds both marks and toggles via an in-SVG media query — this is what
    //   makes Chrome/Firefox switch (Chrome ignores the link `media` attribute).
    // - the light/dark PNGs cover Safari, which honors the link `media` attribute but
    //   ignores SVG favicons.
    // - favicon.ico is the plain legacy fallback (no `sizes:any`, so it can't outrank the SVG).
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-light.png', type: 'image/png', media: '(prefers-color-scheme: light)' },
        { url: '/favicon-dark.png', type: 'image/png', media: '(prefers-color-scheme: dark)' },
        { url: '/favicon.ico', sizes: '48x48' },
      ],
      apple: { url: '/apple-icon.png', sizes: '180x180' },
    },
    alternates: {
      types: {
        'application/rss+xml': '/feed.xml',
      },
    },
  };
}

export default async function LocaleLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} className={fraunces.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>
            <PostHogProvider>{children}</PostHogProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
