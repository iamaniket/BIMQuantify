import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';

export function BlogHero(): JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]" />
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(95,217,158,0.15),transparent)]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-16 sm:py-20">
        <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
          Blog
        </span>
        <h1 className="max-w-2xl text-h3 font-semibold text-white sm:text-h2">
          Insights & updates
        </h1>
        <p className="max-w-xl text-body1 text-white/70">
          BIM quantification, Dutch building regulations, and product updates.
        </p>
      </div>
    </section>
  );
}
