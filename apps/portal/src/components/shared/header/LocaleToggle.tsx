'use client';

import { useTransition, type JSX } from 'react';

import { useLocale } from 'next-intl';

import { type Locale } from '@bimstitch/i18n';

import { usePathname, useRouter } from '@/i18n/navigation';

type Props = {
  className?: string;
};

export function LocaleToggle({ className }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const nextLocale: Locale = locale === 'nl' ? 'en' : 'nl';
  const label = locale === 'nl' ? 'Switch to English' : 'Schakel naar Nederlands';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          router.replace(pathname, { locale: nextLocale });
        });
      }}
      className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-body3 font-extrabold uppercase tracking-[0.02em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isPending ? 'opacity-50' : ''} ${className ?? ''}`}
    >
      {locale.toUpperCase()}
    </button>
  );
}
