'use client';

import { Card, CardBody } from '@bimdossier/ui';
import {
  Boxes, ClipboardCheck, Key, Lock, ShieldCheck, Users, type AppIcon,
} from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

type ControlKey = 'isolation' | 'encryption' | 'auth' | 'access' | 'audit' | 'platform';

/**
 * The core of the /security page: a card grid of the real, code-verified
 * controls (schema-per-tenant isolation, encryption, hardened auth, least-
 * privilege access, audit logging, hardened platform). Every claim maps to
 * something that exists in the API today — copy lives in
 * `securityPage.controls.items.*` (en + nl), no fabricated controls.
 */
const CONTROLS: { key: ControlKey; icon: AppIcon }[] = [
  { key: 'isolation', icon: Boxes },
  { key: 'encryption', icon: Lock },
  { key: 'auth', icon: Key },
  { key: 'access', icon: Users },
  { key: 'audit', icon: ClipboardCheck },
  { key: 'platform', icon: ShieldCheck },
];

export function SecurityControlsSection(): JSX.Element {
  const t = useTranslations('securityPage.controls');

  return (
    <section className="bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 py-20">
        <SectionHeading
          eyebrow={t('eyebrow')}
          headline={t('headline')}
          subtitle={t('subtitle')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map(({ key, icon: Icon }, i) => (
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
      </div>
    </section>
  );
}
