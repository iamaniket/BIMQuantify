'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';
import { Button } from '@bimstitch/ui';

import { useLocale } from '@/providers/LocaleProvider';

const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001';

export function HeroSection(): JSX.Element {
  const { t } = useLocale();

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]" />
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(95,217,158,0.15),transparent)]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-24 sm:py-32">
        <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
          {t.hero.badge}
        </span>

        <h1 className="max-w-3xl text-h2 font-semibold text-white sm:text-h1">
          {t.hero.headline}
        </h1>

        <p className="max-w-2xl text-title3 text-white/80">
          {t.hero.subtitle}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href="/request-access">
            <Button
              variant="primary"
              size="lg"
              className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
            >
              {t.hero.ctaPrimary}
            </Button>
          </Link>
          <a href={portalUrl}>
            <Button
              variant="ghost"
              size="lg"
              className="border border-white/20 text-white hover:bg-white/10"
            >
              {t.hero.ctaSecondary}
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
