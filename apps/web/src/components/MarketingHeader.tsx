'use client';

import { BrandMark } from '@bimdossier/brand';
import { Button, ThemeToggle } from '@bimdossier/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { LanguageToggle } from '@/components/LanguageToggle';
import { Link, usePathname } from '@/i18n/navigation';
import { portalHref } from '@/lib/portalLinks';

type NavItem = { label: string; href: string; activeMatch?: string; external?: boolean };

/**
 * Sticky marketing top-nav. Surfaces Features, FAQ, Security and Blog on every
 * marketing page, plus the two front-door actions on the right: a Log in link
 * and the primary Start for free button (both link out to the portal). Carries
 * the language + theme toggles. Active state is derived from the locale-stripped
 * pathname.
 */
export function MarketingHeader(): JSX.Element {
  const t = useTranslations('header');
  const tBrand = useTranslations('shared.brand');
  const locale = useLocale();
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { label: t('features'), href: '/#features' },
    { label: t('faq'), href: '/#faq' },
    { label: t('security'), href: '/security', activeMatch: '/security' },
    { label: t('blog'), href: '/blog', activeMatch: '/blog' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-8xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 text-primary">
          <BrandMark size={40} />
          <span className="flex flex-col leading-tight">
            <span className="text-title2 font-semibold">{t('brand')}</span>
            <span className="hidden text-body3 font-medium text-foreground-tertiary sm:block">
              {tBrand('strapline')}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => {
            const active = item.activeMatch ? pathname.startsWith(item.activeMatch) : false;
            const className = active
              ? 'text-body2 font-semibold text-primary'
              : 'text-body2 font-medium text-foreground-secondary transition-colors hover:text-primary';
            return item.external ? (
              <a key={item.href} href={item.href} className={className}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={portalHref(locale, '/login')}
            className="hidden text-body2 font-medium text-foreground-secondary transition-colors hover:text-primary sm:inline"
          >
            {t('login')}
          </a>
          <a href={portalHref(locale, '/signup')}>
            <Button variant="primary" size="md">
              {t('startFree')}
            </Button>
          </a>
          <LanguageToggle />
          <ThemeToggle ariaLabel={t('themeToggle')} />
        </div>
      </div>
    </header>
  );
}
