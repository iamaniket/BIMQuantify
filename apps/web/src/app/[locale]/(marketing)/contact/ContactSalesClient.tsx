'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';
import { Button } from '@bimstitch/ui';
import { ArrowRight, CalendarClock, Mail } from '@bimstitch/ui/icons';

import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';

export function ContactSalesClient(): JSX.Element {
  const t = useTranslations('contactPage');
  const tHeader = useTranslations('header');
  const bookingUrl = env.NEXT_PUBLIC_CONTACT_BOOKING_URL;
  const contactEmail = env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]" />
        <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(95,217,158,0.15),transparent)]" />

        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-24 text-center sm:py-32">
          <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
            {t('eyebrow')}
          </span>
          <h1 className="max-w-2xl text-h3 font-semibold text-white sm:text-h2">
            {t('headline')}
          </h1>
          <p className="max-w-xl text-title3 text-white/80">
            {t('subtitle')}
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-low p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-title2 font-semibold text-foreground">
              {t('bookCall')}
            </h2>
            <p className="text-body2 text-foreground-secondary">
              {t('bookCallDescription')}
            </p>
            {bookingUrl ? (
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-auto">
                <Button variant="primary" size="md" className="w-full">
                  {t('bookCall')}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </a>
            ) : (
              <p className="mt-auto text-body3 text-foreground-tertiary">
                {t('noBookingUrl')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-low p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-title2 font-semibold text-foreground">
              {t('orEmail')}
            </h2>
            <p className="text-body2 text-foreground-secondary">
              {t('emailDescription')}
            </p>
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`} className="mt-auto">
                <Button variant="border" size="md" className="w-full">
                  {t('emailButton')}
                  <Mail className="ml-1.5 h-4 w-4" />
                </Button>
              </a>
            ) : (
              <Link href="/request-access" className="mt-auto">
                <Button variant="border" size="md" className="w-full">
                  {tHeader('requestAccess')}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
