'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { JSX } from 'react';

import { Button, ThemeToggle } from '@bimstitch/ui';
import { Menu, X } from '@bimstitch/ui/icons';

import { LanguageToggle } from '@/components/LanguageToggle';
import { Link } from '@/i18n/navigation';

const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001';

export function Header(): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useTranslations('header');

  const navLinks = [
    { label: t('features'), href: '/#features' },
    { label: t('blog'), href: '/blog' },
    { label: t('contactSales'), href: '/contact' },
    { label: t('requestAccess'), href: '/request-access' },
  ] as const;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background-secondary/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="text-title2 font-semibold text-foreground hover:text-primary"
        >
          {t('brand')}
        </Link>

        <nav className="hidden items-center gap-6 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-body2 font-medium text-foreground-secondary hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          <a href={portalUrl} className="hidden sm:inline-block">
            <Button variant="primary" size="md">
              {t('signIn')}
            </Button>
          </a>
          <button
            type="button"
            onClick={() => { setMobileOpen(!mobileOpen); }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-background-hover sm:hidden"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background-secondary px-6 py-4 sm:hidden">
          <nav className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => { setMobileOpen(false); }}
                className="text-body2 font-medium text-foreground-secondary hover:text-primary"
              >
                {link.label}
              </Link>
            ))}
            <a href={portalUrl}>
              <Button variant="primary" size="md" className="w-full">
                {t('signIn')}
              </Button>
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
