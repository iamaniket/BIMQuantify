import type { JSX, ReactNode } from 'react';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { KpiStrip, type KpiItem } from '@/components/shared/layout/KpiCard';

export type { KpiItem };

type HeroShellProps = {
  image: ReactNode;
  title: string;
  description?: string | null;
  subtitle?: ReactNode;
  badge?: ReactNode;
  kpis: KpiItem[];
  action?: ReactNode;
};

export function HeroShell({
  image,
  title,
  description,
  subtitle,
  badge,
  kpis,
  action,
}: HeroShellProps): JSX.Element {
  return (
    <div className="relative h-full overflow-hidden bg-surface-main text-foreground">
      <BlueprintTexture />

      <div className="relative z-10 flex h-full items-center gap-5 px-4 py-4 sm:px-5">
        {/* Left — general info (image + identity) */}
        <div className="flex min-w-0 flex-1 items-center gap-5">
          <div className="hidden shrink-0 xl:block">{image}</div>

          <div className="min-w-0 flex-1 overflow-hidden">
          {badge !== undefined && (
            <div className="mb-1 flex flex-wrap items-center gap-2">{badge}</div>
          )}
          <h1 className="line-clamp-2 font-sans text-[28px] font-medium leading-[1.15] tracking-[-0.022em] sm:text-[32px]">
            {title}
          </h1>
          {description !== undefined && description !== null && description.length > 0 && (
            <p className="mt-0.5 line-clamp-1 text-[13px] text-foreground-secondary">
              {description}
            </p>
          )}
          {subtitle !== undefined && (
            <div className="mt-1 flex flex-wrap gap-3.5 text-body3 text-foreground-tertiary">
              {subtitle}
            </div>
          )}
          </div>
        </div>

        {/* Right — KPI cards + optional action (40% width) */}
        <div className="hidden w-2/5 shrink-0 items-center xl:flex">
          <div className="min-w-0 flex-1">
            <KpiStrip items={kpis} />
          </div>
          {action !== undefined && (
            <div className="shrink-0 pl-2">{action}</div>
          )}
        </div>
      </div>
    </div>
  );
}
