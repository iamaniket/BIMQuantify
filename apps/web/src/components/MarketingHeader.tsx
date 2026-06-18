'use client';

import { BrandMark } from '@bimstitch/brand';
import { ThemeToggle } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { LanguageToggle } from '@/components/LanguageToggle';
import { Link, usePathname } from '@/i18n/navigation';
import { env } from '@/lib/env';

type NavItem = { label: string; href: string; activeMatch?: string };

/**
 * Sticky marketing top-nav. Surfaces Blog (and Features / Request access) on
 * every marketing page — previously the blog was reachable only from the
 * footer. Carries the language + theme toggles (moved out of the hero corner)
 * and a Sign-in link to the portal. Active state is derived from the
 * locale-stripped pathname.
 */
export function MarketingHeader(): JSX.Element {
  const t = useTranslations('header');
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { label: t('features'), href: '/#features' },
    { label: t('blog'), href: '/blog', activeMatch: '/blog' },
    { label: t('requestAccess'), href: '/request-access', activeMatch: '/request-access' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark size={26} tone="on-light" />
          <span className="text-title3 font-semibold text-foreground">{t('brand')}</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => {
            const active = item.activeMatch ? pathname.startsWith(item.activeMatch) : false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'text-body2 font-semibold text-primary'
                    : 'text-body2 font-medium text-foreground-secondary transition-colors hover:text-primary'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={env.NEXT_PUBLIC_PORTAL_URL}
            className="hidden text-body2 font-medium text-foreground-secondary transition-colors hover:text-primary sm:inline-flex"
          >
            {t('signIn')}
          </a>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
