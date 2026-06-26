import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Fraunces } from 'next/font/google';
import { notFound } from 'next/navigation';
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
import { routing } from '@/i18n/routing';
import { IconProvider } from '@bimdossier/ui/providers';
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
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/*
          No-flash theme script: sets `data-theme` on <html> before paint, standing in for
          next-themes' own injected script (disabled via patches/next-themes@0.4.6.patch).

          It is wrapped in a host element with `dangerouslySetInnerHTML` on purpose. React 19
          recreates any <script> it renders as a host element on the client (hydration never
          claims script nodes), and logs "Encountered a script tag while rendering React
          component…" for it. Nesting the raw <script> inside a parent's inner HTML keeps it
          opaque to React — no <script> fiber, no warning — while it is still emitted verbatim
          into the SSR HTML, so the browser runs it synchronously during the initial parse at
          the top of <body>, before first paint. `next/script` beforeInteractive would dodge
          the warning too, but it defers execution via the __next_s queue and flashes.
        */}
        <div
          hidden
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `<script>(function(){var e=document.documentElement;function a(t){e.setAttribute('data-theme',t);if(t==='light'||t==='dark')e.style.colorScheme=t;}function s(){return window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}try{var v=localStorage.getItem('theme')||'system';a(v==='system'?s():v);}catch(_){}})()</script>`,
          }}
        />
        <NextIntlClientProvider>
          <LocaleMigrationShim />
          <ThemeProvider>
            <IconProvider>
              <QueryProvider>
                <AuthProvider>
                  <PostHogProvider>
                    {children}
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
