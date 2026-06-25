import type { ReactNode } from 'react';

export function HeroImage({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex h-[112px] w-[160px] items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-primary to-primary-light shadow-hero-thumbnail">
      {children}
    </div>
  );
}
