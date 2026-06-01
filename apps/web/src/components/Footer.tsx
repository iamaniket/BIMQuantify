'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { BrandMark } from '@bimstitch/brand';

import { useLocale } from '@/providers/LocaleProvider';

const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001';

type FooterLink = {
  label: string;
  href: string;
  external: boolean | undefined;
};

type FooterColumn = {
  title: string;
  links: FooterLink[];
};

export function Footer(): JSX.Element {
  const { t } = useLocale();

  const columns: FooterColumn[] = [
    {
      title: t.footer.product,
      links: [
        { label: t.header.features, href: '/#features', external: undefined },
        { label: t.header.requestAccess, href: '/request-access', external: undefined },
        { label: t.header.signIn, href: portalUrl, external: true },
      ],
    },
    {
      title: t.footer.resources,
      links: [
        { label: t.header.blog, href: '/blog', external: undefined },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { label: t.footer.privacy, href: '/legal/privacy', external: undefined },
        { label: t.footer.terms, href: '/legal/terms', external: undefined },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <div className="flex items-center gap-2">
              <BrandMark size={28} tone="on-light" />
              <span className="text-title3 font-semibold text-foreground">
                {t.header.brand}
              </span>
            </div>
            <p className="text-body3 text-foreground-tertiary">
              {t.footer.tagline}
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <span className="text-body3 font-semibold text-foreground">
                {col.title}
              </span>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        className="text-body3 text-foreground-secondary hover:text-primary"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-body3 text-foreground-secondary hover:text-primary"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6 text-center text-caption text-foreground-tertiary">
          © {new Date().getFullYear()} {t.footer.copyright}
        </div>
      </div>
    </footer>
  );
}
