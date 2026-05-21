import type { JSX, ReactNode } from 'react';

type PageShellProps = {
  hero: ReactNode;
  children: ReactNode;
};

export function PageShell({ hero, children }: PageShellProps): JSX.Element {
  return (
    <div className="grid h-full grid-rows-[3fr_17fr] overflow-hidden">
      <div className="min-h-0 overflow-y-auto">{hero}</div>
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}
