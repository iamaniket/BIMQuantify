'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { SectionHeading } from '@/components/shared/SectionHeading';

/**
 * Responsible-disclosure band for the /security page: a security@ mailto and a
 * link to the static RFC 9116 /.well-known/security.txt. The security.txt link
 * is a plain anchor (not the locale-aware Link) so it resolves to the file at
 * the site root, not a locale-prefixed route. Copy in `securityPage.disclosure.*`.
 */
export function SecurityDisclosureSection(): JSX.Element {
  const t = useTranslations('securityPage.disclosure');
  const email = t('email');

  return (
    <section className="bg-surface-low">
      <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
        <SectionHeading
          eyebrow={t('eyebrow')}
          headline={t('headline')}
          subtitle={t('body')}
          className="mb-8"
        />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <a
            href={`mailto:${email}`}
            className="text-body2 font-medium text-primary hover:underline"
          >
            {t('emailLabel')}
          </a>
          <a
            href="/.well-known/security.txt"
            className="text-body2 font-medium text-primary hover:underline"
          >
            {t('txtLabel')}
          </a>
        </div>
      </div>
    </section>
  );
}
