import type { ReactNode } from 'react';

type Props = {
  eyebrow: string;
  title: string;
  sub?: string;
};

export function PanelHeading({ eyebrow, title, sub }: Props): ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
        <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary after:ml-2 after:opacity-50 after:content-['·']">
          {eyebrow}
        </div>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-body2 font-bold">{title}</h2>
          {sub !== undefined && sub !== '' && (
            <span className="text-body3 text-foreground-tertiary before:mr-1.5 before:opacity-60 before:content-['·']">
              {sub}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
