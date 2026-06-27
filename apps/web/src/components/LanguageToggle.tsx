'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

import { usePathname, useRouter } from '@/i18n/navigation';

type Props = {
  className?: string;
};

export function LanguageToggle({ className }: Props): JSX.Element {
  const locale = useLocale();
  const t = useTranslations('languageToggle');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const nextLocale = locale === 'en' ? 'nl' : 'en';

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(() => {
          router.replace(pathname, { locale: nextLocale });
        });
      }}
      disabled={isPending}
      className={cn(
        'inline-flex h-8 items-center rounded-md px-2 text-body3 font-semibold text-foreground-secondary hover:bg-background-hover disabled:opacity-50',
        className,
      )}
      aria-label={t('ariaLabel', { language: t('label') })}
    >
      {t('label')}
    </button>
  );
}
