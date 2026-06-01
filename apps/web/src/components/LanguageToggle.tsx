'use client';

import type { JSX } from 'react';

import { useLocale } from '@/providers/LocaleProvider';

export function LanguageToggle(): JSX.Element {
  const { locale, t, setLocale } = useLocale();

  return (
    <button
      type="button"
      onClick={() => { setLocale(locale === 'en' ? 'nl' : 'en'); }}
      className="inline-flex h-8 items-center rounded-md px-2 text-body3 font-semibold text-foreground-secondary hover:bg-background-hover"
      aria-label={`Switch to ${t.languageToggle.label}`}
    >
      {t.languageToggle.label}
    </button>
  );
}
