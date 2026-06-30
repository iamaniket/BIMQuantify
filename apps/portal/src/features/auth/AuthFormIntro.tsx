import type { JSX, ReactNode } from 'react';

type AuthFormIntroProps = {
  eyebrow: string;
  heading: ReactNode;
  subtitle?: ReactNode;
}

/**
 * Eyebrow + heading + subtitle block at the top of every auth-pane form
 * (login, request-access, forgot/reset password). Pulled out to lock the
 * typography in one place.
 */
export function AuthFormIntro({ eyebrow, heading, subtitle }: AuthFormIntroProps): JSX.Element {
  return (
    <div className="mb-5">
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
        {eyebrow}
      </div>
      <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
        {heading}
      </h2>
      {subtitle !== undefined && (
        <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
          {subtitle}
        </p>
      )}
    </div>
  );
}
