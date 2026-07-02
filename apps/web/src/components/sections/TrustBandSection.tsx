'use client';

import { Card, CardBody } from '@bimdossier/ui';
import {
  ArrowRight, Scale, ShieldCheck, Users, type AppIcon,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Link } from '@/i18n/navigation';
import { portalHref } from '@/lib/portalLinks';

type TrustKey = 'hosting' | 'instrument' | 'team';

/**
 * Honest trust band for regulated work. Answers the three questions a Dutch
 * contractor asks before trusting a legally load-bearing dossier to a young
 * product: where does my data live (+ DPA), does this replace my kwaliteitsborger
 * /instrument (it doesn't), and who is behind it. Every claim is true at founding
 * stage, no fabricated counts, logos, or quotes. Copy lives in the `trust.*`
 * catalog (en + nl).
 */
const TRUST_ITEMS: { key: TrustKey; icon: AppIcon }[] = [
  { key: 'hosting', icon: ShieldCheck },
  { key: 'instrument', icon: Scale },
  { key: 'team', icon: Users },
];

export function TrustBandSection(): JSX.Element {
  const t = useTranslations('trust');
  const locale = useLocale();

  return (
    <section id="trust" className="bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 py-20">
        <SectionHeading
          eyebrow={t('eyebrow')}
          headline={t('headline')}
          subtitle={t('subtitle')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TRUST_ITEMS.map(({ key, icon: Icon }, i) => (
            <Reveal key={key} delay={i * 80} className="h-full">
              <Card className="h-full">
                <CardBody className="gap-4">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-title3 font-semibold text-foreground">
                      {t(`items.${key}.title`)}
                    </h3>
                    <p className="text-body2 text-foreground-secondary">
                      {t(`items.${key}.body`)}
                    </p>
                  </div>
                  {key === 'hosting' ? (
                    <div className="mt-auto flex flex-col gap-2">
                      <Link
                        href="/security"
                        className="group inline-flex items-center gap-1.5 text-body2 font-medium text-primary hover:underline"
                      >
                        {t('securityLink')}
                        <ArrowRight
                          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none"
                          aria-hidden
                        />
                      </Link>
                      <a
                        href={portalHref(locale, '/legal/dpa')}
                        className="group inline-flex items-center gap-1.5 text-body2 font-medium text-primary hover:underline"
                      >
                        {t('dpaLink')}
                        <ArrowRight
                          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none"
                          aria-hidden
                        />
                      </a>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
