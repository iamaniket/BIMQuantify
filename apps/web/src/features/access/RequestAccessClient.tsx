'use client';

import {
  AuthShell,
  RequestAccessForm,
  RequestAccessSuccess,
  composeAccessRequestNotes,
  type RequestAccessValues,
} from '@bimdossier/brand';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { MarketingBrandPanel } from '@/components/MarketingBrandPanel';
import { Link } from '@/i18n/navigation';
import { captureEvent } from '@/lib/analytics';
import { submitAccessRequest, WebApiError } from '@/lib/api';
import { env } from '@/lib/env';

type SubmittedState = {
  name: string;
  email: string;
  company: string;
};

export function RequestAccessClient(): JSX.Element {
  const t = useTranslations('requestAccessPage');
  const tIntro = useTranslations('requestAccessPage.intro');
  const tBrand = useTranslations('shared.brand');
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  const tErrors = useTranslations('requestAccessPage.errors');

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
        notes: composeAccessRequestNotes(values),
        terms_accepted: values.terms_accepted,
      });
      setSubmitted({ name: values.name, email: values.work_email, company: values.company });
      captureEvent('web.request_access_submitted', {
        company_size: values.company_size,
        country: values.country,
        role: values.role,
      });
    } catch (err) {
      if (err instanceof WebApiError) {
        if (err.status === 409 && err.detail === 'ACCESS_REQUEST_PENDING_DUPLICATE') {
          setSubmitError(tErrors('pendingDuplicate'));
        } else if (err.status === 409 && err.detail === 'ACCESS_REQUEST_ALREADY_APPROVED') {
          setSubmitError(tErrors('alreadyApproved'));
        } else if (err.status === 422) {
          setSubmitError(err.detail);
        } else if (err.status === 429) {
          setSubmitError(tErrors('rateLimited'));
        } else {
          setSubmitError(tErrors('generic', { detail: err.detail }));
        }
      } else {
        setSubmitError(tErrors('unreachable'));
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
                {tIntro('eyebrow')}
              </div>
              <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
                {tBrand('pilotHeading')}
              </h2>
              <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
                {tIntro('subtitle')}
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
