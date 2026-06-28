'use client';

import { cn } from '@bimdossier/ui';
// Icon names mirror the sibling `featureCatalog.ts`: these are the supported
// `@bimdossier/ui/icons` barrel exports (Lucide-compat aliases over Phosphor).
import {
  CalendarClock,
  Camera,
  ClipboardCheck,
  FileBadge,
  MapPin,
  ShieldCheck,
  Smartphone,
  Users,
  type AppIcon,
} from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

type UseCaseKey =
  | 'snagging'
  | 'inspections'
  | 'photos'
  | 'onsite'
  | 'teamwork'
  | 'certificates'
  | 'handover'
  | 'wkb';

type UseCaseItem = {
  /** i18n key under `useCases.items.*`. */
  key: UseCaseKey;
  icon: AppIcon;
  /** The Wkb card is our flagship use case, so it carries a small badge. */
  flagship: boolean;
};

/**
 * "Who it's for" strip — four doorways into the same product (snagging,
 * inspections, handover, and the flagship Wkb dossier). It lets a buyer who
 * isn't here for the Wkb law still recognise their own job, while keeping Wkb
 * visibly badged as what we built for. Pure presentation: copy comes from the
 * `useCases.*` message namespace, every colour/size is a design token.
 */
const USE_CASES: UseCaseItem[] = [
  { key: 'snagging', icon: MapPin, flagship: false },
  { key: 'inspections', icon: ClipboardCheck, flagship: false },
  { key: 'photos', icon: Camera, flagship: false },
  { key: 'onsite', icon: Smartphone, flagship: false },
  { key: 'teamwork', icon: Users, flagship: false },
  { key: 'certificates', icon: FileBadge, flagship: false },
  { key: 'handover', icon: ShieldCheck, flagship: false },
  { key: 'wkb', icon: CalendarClock, flagship: true },
];

export function UseCasesSection(): JSX.Element {
  const t = useTranslations('useCases');

  return (
    <section id="use-cases" className="mx-auto w-full max-w-8xl px-6 py-20">
      <SectionHeading eyebrow={t('eyebrow')} headline={t('headline')} subtitle={t('subtitle')} />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {USE_CASES.map(({ key, icon: Icon, flagship }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <article
              className={cn(
                'relative flex h-full flex-col gap-4 rounded-2xl border bg-surface-main p-6 shadow-sm',
                flagship ? 'border-primary' : 'border-border',
              )}
            >
              {flagship ? (
                <span className="absolute right-4 top-4 inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-caption font-semibold uppercase tracking-wide text-primary-foreground">
                  {t('flagship')}
                </span>
              ) : null}

              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-low text-primary ring-1 ring-border">
                <Icon className="h-6 w-6" aria-hidden />
              </span>

              <h3 className="text-title3 font-semibold text-foreground">
                {t(`items.${key}.title`)}
              </h3>
              <p className="text-body2 text-foreground-secondary">{t(`items.${key}.body`)}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
