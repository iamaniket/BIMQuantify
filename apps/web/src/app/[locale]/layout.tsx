import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Fraunces } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/providers/ThemeProvider';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export function generateStaticParams(): Array<{ locale: string }> {
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
    title: {
      default: t('defaultTitle'),
      template: '%s — BimDossier',
    },
    description: t('description'),
    openGraph: {
      type: 'website',
      siteName: 'BimDossier',
      title: t('defaultTitle'),
      description: t('description'),
      locale: locale === 'nl' ? 'nl_NL' : 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
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
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
