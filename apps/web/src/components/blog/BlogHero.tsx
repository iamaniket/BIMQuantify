import type { JSX } from 'react';

import { HeroShell } from '@/components/sections/HeroShell';

export function BlogHero(): JSX.Element {
  return (
    <HeroShell size="page" className="gap-3">
      <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
        Blog
      </span>
      <h1 className="max-w-2xl text-h3 font-semibold text-white sm:text-h2">
        Insights & updates
      </h1>
      <p className="max-w-xl text-body1 text-white/70">
        BIM quantification, Dutch building regulations, and product updates.
      </p>
    </HeroShell>
  );
}
