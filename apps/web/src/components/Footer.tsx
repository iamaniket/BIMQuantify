'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { BrandMark } from '@bimdossier/brand';

import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';
import { portalHref } from '@/lib/portalLinks';

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
  const tHeader = useTranslations('header');
  const tFooter = useTranslations('footer');
  const tBrand = useTranslations('shared.brand');
  const tLegal = useTranslations('shared.legal');
  const locale = useLocale();

  const connectLinks: FooterLink[] = [];
  if (env.NEXT_PUBLIC_SOCIAL_YOUTUBE_URL) {
    connectLinks.push({
      label: tFooter('youtube'),
      href: env.NEXT_PUBLIC_SOCIAL_YOUTUBE_URL,
      external: true,
    });
  }
  if (env.NEXT_PUBLIC_SOCIAL_LINKEDIN_URL) {
    connectLinks.push({
      label: tFooter('linkedin'),
      href: env.NEXT_PUBLIC_SOCIAL_LINKEDIN_URL,
      external: true,
    });
  }
  if (env.NEXT_PUBLIC_CONTACT_EMAIL) {
    connectLinks.push({
      label: tFooter('email'),
      href: `mailto:${env.NEXT_PUBLIC_CONTACT_EMAIL}`,
      external: true,
    });
  }

  const columns: FooterColumn[] = [
    {
      title: tFooter('product'),
      links: [
        { label: tHeader('features'), href: '/#features', external: undefined },
        { label: tHeader('contactSales'), href: '/contact', external: undefined },
        // Request access + legal pages live in the portal — link out.
        { label: tHeader('requestAccess'), href: portalHref(locale, '/request-access'), external: true },
      ],
    },
    {
      title: tFooter('resources'),
      links: [
        { label: tHeader('blog'), href: '/blog', external: undefined },
      ],
    },
    {
      title: tFooter('legal'),
      links: [
        // Security lives on the marketing site (not the portal) — link in-site.
        { label: tHeader('security'), href: '/security', external: undefined },
        { label: tLegal('privacy'), href: portalHref(locale, '/legal/privacy'), external: true },
        { label: tLegal('terms'), href: portalHref(locale, '/legal/terms'), external: true },
        { label: tLegal('dpa'), href: portalHref(locale, '/legal/dpa'), external: true },
      ],
    },
  ];

  if (connectLinks.length > 0) {
    columns.push({ title: tFooter('connect'), links: connectLinks });
  }

  return (
    <footer className="border-t border-border bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 py-12">
        <div
          className={`grid grid-cols-2 gap-8 ${
            connectLinks.length > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          }`}
        >
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <div className="flex items-center gap-2 text-primary">
              <BrandMark size={31} />
              <span className="text-title2 font-semibold">
                {tHeader('brand')}
              </span>
            </div>
            <p className="text-body3 text-foreground-tertiary">
              {tBrand('tagline')}
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
          © {new Date().getFullYear()} {tBrand('legalEntity')}
        </div>
      </div>
    </footer>
  );
}
