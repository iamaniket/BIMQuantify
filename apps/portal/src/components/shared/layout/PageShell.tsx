import type { JSX, ReactNode } from 'react';

type PageShellProps = {
  hero: ReactNode;
  children: ReactNode;
};

export function PageShell({ hero, children }: PageShellProps): JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-hidden md:grid md:grid-rows-[12rem_1fr]">
      <div className="hidden min-h-0 overflow-hidden md:block">{hero}</div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
