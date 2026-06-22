import type { ReactNode } from 'react';

export function HeroImage({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex h-[112px] w-[160px] items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-primary to-primary-light shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
      {children}
    </div>
  );
}
