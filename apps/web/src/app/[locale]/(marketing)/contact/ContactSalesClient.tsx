'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';
import { ArrowRight, CalendarClock, Mail } from '@bimstitch/ui/icons';

import { HeroPill } from '@/components/sections/HeroPill';
import { HeroShell } from '@/components/sections/HeroShell';
import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';

export function ContactSalesClient(): JSX.Element {
  const t = useTranslations('contactPage');
  const tHeader = useTranslations('header');
  const bookingUrl = env.NEXT_PUBLIC_CONTACT_BOOKING_URL;
  const contactEmail = env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <>
      <HeroShell size="splash" align="center" className="max-w-3xl gap-4">
        <HeroPill>{t('eyebrow')}</HeroPill>
        <h1 className="max-w-2xl text-h3 font-semibold text-white sm:text-h2">
          {t('headline')}
        </h1>
        <p className="max-w-xl text-title3 text-white/80">{t('subtitle')}</p>
      </HeroShell>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-low p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-lighter">
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
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-lighter">
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
