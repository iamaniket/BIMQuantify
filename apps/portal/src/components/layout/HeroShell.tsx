import type { JSX, ReactNode } from 'react';

import { BlueprintTexture } from '@/components/BlueprintTexture';

type KpiItem = {
  label: string;
  value: string;
  color?: string;
  sub?: ReactNode;
};

type HeroShellProps = {
  image: ReactNode;
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  kpis: KpiItem[];
  action?: ReactNode;
};

export function HeroShell({
  image,
  title,
  subtitle,
  badge,
  kpis,
  action,
}: HeroShellProps): JSX.Element {
  return (
    <div className="relative h-full overflow-hidden bg-surface-main text-foreground">
      <BlueprintTexture />

      <div className="relative z-10 grid h-full items-center gap-5 px-4 py-4 sm:px-5 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        {/* Left — visual (thumbnail, icon, avatar) */}
        <div className="hidden xl:block">{image}</div>

        {/* Middle — identity */}
        <div className="min-w-0">
          {badge !== undefined && (
            <div className="mb-1 flex flex-wrap items-center gap-2">{badge}</div>
          )}
          <h1 className="truncate font-display text-[28px] font-medium leading-[1.05] tracking-[-0.022em] sm:text-[32px]">
            {title}
          </h1>
          {subtitle !== undefined && (
            <div className="mt-1 flex flex-wrap gap-3.5 text-body3 text-foreground-tertiary">
              {subtitle}
            </div>
          )}
        </div>

        {/* Right — KPI cards + optional action */}
        <div className="flex items-center gap-2">
          <div className="grid w-full grid-cols-2 gap-2 xl:flex xl:items-stretch xl:gap-0">
            {kpis.map((item, i) => (
              <div
                key={item.label}
                className={`flex min-w-0 flex-col justify-center rounded-lg border border-border bg-surface-low px-3 py-2 dark:bg-black/30 xl:min-w-[124px] xl:rounded-none xl:border-0 xl:bg-transparent xl:px-[22px] xl:py-1 ${
                  i === 0 ? '' : 'xl:border-l xl:border-border'
                }`}
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-tertiary">
                  {item.label}
                </div>
                <div
                  className="mt-[3px] font-display text-[22px] font-semibold leading-[1.05] tracking-[-0.015em] tabular-nums"
                  style={{ color: item.color ?? 'currentColor' }}
                >
                  {item.value}
                </div>
                {item.sub !== undefined && (
                  <div className="mt-[3px] whitespace-nowrap text-[10.5px] text-foreground-tertiary">
                    {item.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
          {action}
        </div>
      </div>
    </div>
  );
}
