import { Check } from '@bimdossier/ui/icons';
import type { JSX } from 'react';

export interface RequestAccessSuccessProps {
  name: string;
  email: string;
  company: string;
  onReset?: () => void;
}

export function RequestAccessSuccess({
  name,
  email,
  company,
  onReset,
}: RequestAccessSuccessProps): JSX.Element {
  const firstName = name.split(' ')[0] ?? name;
  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden
        className="grid size-12 place-items-center rounded-full"
        style={{ background: 'var(--success-light, #eaf6ef)', color: 'var(--success, #3f8f65)' }}
      >
        <Check className="h-[22px] w-[22px]" weight="bold" />
      </div>

      <div>
        <div
          className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em]"
          style={{ color: 'var(--success, #3f8f65)' }}
        >
          Application received
        </div>
        <h2 className="m-0 font-display text-[28px] font-medium leading-tight tracking-tight text-foreground">
          Thanks, {firstName}. We&rsquo;ll be in touch shortly.
        </h2>
        <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
          We&rsquo;ve logged your pilot application for{' '}
          <strong className="text-foreground-secondary">{company}</strong> and will send a
          personalised invitation to <strong className="text-foreground-secondary">{email}</strong> after
          a quick review.
        </p>
      </div>

      <div>
        <div className="mb-2.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-foreground-tertiary">
          What happens next
        </div>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {[
            ['1', 'A BimDossier admin reviews your application', 'We review every application personally, in NL or EN.'],
            ['2', 'You receive an invite email', "It includes a verified link to set your password."],
            ['3', 'Your sandbox is ready', 'Pre-loaded with sample Wet kwaliteitsborging voor het bouwen (Wkb) projects and BBL libraries.'],
          ].map(([n, t, d]) => (
            <li key={n} className="flex items-start gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border bg-surface-low font-sans text-[11px] font-bold text-foreground-secondary">
                {n}
              </span>
              <span className="text-[12.5px] leading-snug text-foreground-secondary">
                <strong className="text-foreground">{t}.</strong>{' '}
                <span className="text-foreground-tertiary">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-1 h-10 cursor-pointer rounded-md border border-border bg-transparent text-[12.5px] font-semibold text-foreground-secondary hover:bg-surface-low"
        >
          Submit another application
        </button>
      ) : null}
    </div>
  );
}
