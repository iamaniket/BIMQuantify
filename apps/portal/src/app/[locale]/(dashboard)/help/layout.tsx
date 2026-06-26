'use client';

import type { ReactNode } from 'react';

import { PageShell } from '@/components/shared/layout/PageShell';
import { HelpHero } from '@/features/help/HelpHero';
import { HelpNavRail } from '@/features/help/HelpNavRail';

/**
 * Help center shell — renders the hero (with KPIs) and the persistent 15% topic-nav rail
 * once. Only the 85% content pane (`children`) swaps as you navigate between `/help` and
 * `/help/[slug]`. Inherits the (dashboard) layout's auth gate.
 */
export default function HelpLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <PageShell hero={<HelpHero />}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[minmax(11rem,15%)_1fr]">
        <HelpNavRail />
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </PageShell>
  );
}
