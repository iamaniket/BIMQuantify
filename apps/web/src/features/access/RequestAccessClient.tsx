'use client';

import {
  AuthShell,
  RequestAccessForm,
  RequestAccessSuccess,
  type RequestAccessValues,
} from '@bimstitch/brand';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { MarketingBrandPanel } from '@/components/MarketingBrandPanel';
import { Link } from '@/i18n/navigation';
import { submitAccessRequest, WebApiError } from '@/lib/api';
import { env } from '@/lib/env';

type SubmittedState = {
  name: string;
  email: string;
  company: string;
};

export function RequestAccessClient(): JSX.Element {
  const t = useTranslations('requestAccessPage');
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
      if (err instanceof WebApiError) {
        if (err.status === 422) {
          setSubmitError(err.detail);
        } else if (err.status === 429) {
          setSubmitError('Too many requests from your network — please try again in an hour.');
        } else {
          setSubmitError(`We couldn't submit your request: ${err.detail}`);
        }
      } else {
        setSubmitError('We couldn’t reach the BimDossier API. Please try again in a moment.');
      }
    }
  };

  const signInHref = `${env.NEXT_PUBLIC_PORTAL_URL.replace(/\/$/, '')}/login`;

  return (
    <AuthShell
      brand={<MarketingBrandPanel />}
      topRight={(
        <Link href="/" className="inline-flex items-center gap-1.5 font-sans text-[11.5px] tracking-[0.02em] text-foreground-tertiary no-underline hover:text-foreground">
          <span aria-hidden>&larr;</span>
          {t('backToHome')}
        </Link>
      )}
      form={(
        submitted === null ? (
          <>
            <div className="mb-5">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                Request access
              </div>
              <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
                Get your BimDossier demo.
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
              signInHref={signInHref}
            />
          </>
        ) : (
          <RequestAccessSuccess
            name={submitted.name}
            email={submitted.email}
            company={submitted.company}
            onReset={() => { setSubmitted(null); }}
          />
        )
      )}
    />
  );
}
