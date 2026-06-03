'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { BrandMark } from '@bimstitch/brand';

import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';

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
        { label: tHeader('requestAccess'), href: '/request-access', external: undefined },
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
        { label: tLegal('privacy'), href: '/legal/privacy', external: undefined },
        { label: tLegal('terms'), href: '/legal/terms', external: undefined },
        { label: tLegal('dpa'), href: '/legal/dpa', external: undefined },
      ],
    },
  ];

  if (connectLinks.length > 0) {
    columns.push({ title: tFooter('connect'), links: connectLinks });
  }

  return (
    <footer className="border-t border-border bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div
          className={`grid grid-cols-2 gap-8 ${
            connectLinks.length > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          }`}
        >
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <div className="flex items-center gap-2">
              <BrandMark size={28} tone="on-light" />
              <span className="text-title3 font-semibold text-foreground">
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
