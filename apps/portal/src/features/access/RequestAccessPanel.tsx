'use client';

import {
  AuthShell,
  RequestAccessForm,
  RequestAccessSuccess,
  type LegalFooterLink,
  type RequestAccessValues,
} from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { AuthHeroBrand } from '@/features/auth/AuthHeroBrand';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/client';
import { submitAccessRequest } from '@/lib/api/accessRequests';

interface SubmittedState {
  name: string;
  email: string;
  company: string;
}

interface RequestAccessPanelProps {
  legalLinks: readonly LegalFooterLink[];
}

export function RequestAccessPanel({ legalLinks }: RequestAccessPanelProps): JSX.Element {
  const t = useTranslations('legal');
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  const onSubmit = async (values: RequestAccessValues): Promise<void> => {
    setSubmitError(undefined);
    try {
      await submitAccessRequest({
        name: values.name,
        work_email: values.work_email,
        company: values.company,
        role: values.role,
        company_size: values.company_size,
        country: values.country,
        notes: values.notes === '' ? undefined : values.notes,
        terms_accepted: values.terms_accepted,
      });
      setSubmitted({ name: values.name, email: values.work_email, company: values.company });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          setSubmitError(err.detail);
        } else if (err.status === 429) {
          setSubmitError('Too many requests from your network — please try again in an hour.');
        } else {
          setSubmitError(`We couldn't submit your request: ${err.detail}`);
        }
      } else {
        setSubmitError('We couldn’t reach the BimStitch API. Please try again in a moment.');
      }
    }
  };

  return (
    <AuthShell
      brand={<AuthHeroBrand legalLinks={legalLinks} />}
      topRight={(
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] tracking-[0.02em] text-foreground-tertiary no-underline hover:text-foreground"
        >
          <span aria-hidden>←</span>
          {t('backToSignIn')}
        </Link>
      )}
      form={(
        submitted === null ? (
          <>
            <div className="mb-4">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                Request access
              </div>
              <h2 className="m-0 font-display text-[28px] font-medium leading-tight tracking-tight text-foreground">
                Get your BimStitch demo.
              </h2>
              <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
                Fill in the form with your work details — we&rsquo;ll review your request and send a
                personalised invite shortly.
              </p>
            </div>
            <RequestAccessForm
              onSubmit={onSubmit}
              submitError={submitError}
              defaultCountry="NL"
              signInHref="/login"
            />
          </>
        ) : (
          <RequestAccessSuccess
            name={submitted.name}
            email={submitted.email}
            company={submitted.company}
            onReset={() => setSubmitted(null)}
          />
        )
      )}
    />
  );
}
