import type { JSX, ReactNode } from 'react';

type PageShellProps = {
  hero: ReactNode;
  children: ReactNode;
};

export function PageShell({ hero, children }: PageShellProps): JSX.Element {
  return (
    <div className="grid h-full grid-rows-[12rem_1fr] overflow-hidden">
      <div className="min-h-0 overflow-hidden">{hero}</div>
      <div className="flex min-h-0 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
