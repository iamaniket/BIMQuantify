import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Fraunces } from 'next/font/google';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import type { JSX, ReactNode } from 'react';
import { Toaster } from 'sonner';

// Brand display face — used on hero copy in the login / request-access
// pages. Variable font, optical-size axis, kept to weights 400/500/600.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  display: 'swap',
});

import { LocaleMigrationShim } from '@/components/LocaleMigrationShim';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { routing } from '@/i18n/routing';
import { IconProvider } from '@bimstitch/ui/providers';
import { AuthProvider } from '@/providers/AuthProvider';
import { PostHogProvider } from '@/providers/PostHogProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} className={fraunces.variable} suppressHydrationWarning>
      {/*
        Theme init script — runs synchronously before hydration to set the correct
        data-theme on <html> and prevent flash of wrong theme. This replaces the
        inline <script> that next-themes would otherwise render inside the React
        component tree (which triggers a React 19 warning).
      */}
      <Script id="theme-init" strategy="beforeInteractive">{`
        (function(){
          var e=document.documentElement;
          function a(t){e.setAttribute('data-theme',t);if(t==='light'||t==='dark')e.style.colorScheme=t;}
          function s(){return window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}
          try{var v=localStorage.getItem('theme')||'system';a(v==='system'?s():v);}catch(_){}
        })()
      `}</Script>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider>
          <LocaleMigrationShim />
          <ServiceWorkerRegistrar />
          <ThemeProvider>
            <IconProvider>
              <QueryProvider>
                <AuthProvider>
                  <PostHogProvider>
                    {children}
                    <PwaInstallPrompt />
                    <Toaster richColors closeButton position="bottom-left" />
                  </PostHogProvider>
                </AuthProvider>
              </QueryProvider>
            </IconProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
