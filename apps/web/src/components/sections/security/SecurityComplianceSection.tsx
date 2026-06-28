'use client';

import { Card, CardBody } from '@bimdossier/ui';
import {
  ArrowRight, CalendarClock, FileBadge, MapPin, Scale, ShieldCheck, Users, type AppIcon,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { portalHref } from '@/lib/portalLinks';

type ComplianceKey = 'residency' | 'gdpr' | 'dpa' | 'retention' | 'breach' | 'boundary';

/**
 * Compliance + data-subject-rights band for the /security page: EU residency,
 * GDPR/AVG, the DPA, 10-year Wkb retention, a 72h breach commitment and the
 * honest "not an approved Wkb instrument" boundary. Links out to the portal's
 * legal pages (DPA + privacy) via `portalHref`. Copy in `securityPage.compliance.*`.
 */
const ITEMS: { key: ComplianceKey; icon: AppIcon }[] = [
  { key: 'residency', icon: MapPin },
  { key: 'gdpr', icon: Scale },
  { key: 'dpa', icon: FileBadge },
  { key: 'retention', icon: CalendarClock },
  { key: 'breach', icon: ShieldCheck },
  { key: 'boundary', icon: Users },
];

export function SecurityComplianceSection(): JSX.Element {
  const t = useTranslations('securityPage.compliance');
  const locale = useLocale();

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-20">
      <SectionHeading
        eyebrow={t('eyebrow')}
        headline={t('headline')}
        subtitle={t('subtitle')}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(({ key, icon: Icon }, i) => (
          <Reveal key={key} delay={i * 70} className="h-full">
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
              </CardBody>
            </Card>
          </Reveal>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <a
          href={portalHref(locale, '/legal/dpa')}
          className="inline-flex items-center gap-1.5 text-body2 font-medium text-primary hover:underline"
        >
          {t('dpaLink')}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
        <a
          href={portalHref(locale, '/legal/privacy')}
          className="inline-flex items-center gap-1.5 text-body2 font-medium text-primary hover:underline"
        >
          {t('privacyLink')}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
      </div>
    </section>
  );
}
