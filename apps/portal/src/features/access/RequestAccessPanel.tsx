'use client';

import {
  RequestAccessForm,
  RequestAccessSuccess,
  type RequestAccessValues,
} from '@bimstitch/brand';
import { useState, type JSX } from 'react';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { ApiError } from '@/lib/api/client';
import { submitAccessRequest } from '@/lib/api/accessRequests';

interface SubmittedState {
  name: string;
  email: string;
  company: string;
}

/**
 * Body content for the request-access page. The surrounding chrome
 * (brand pane + back-to-sign-in link) is provided by `AuthLayoutShell`
 * in the page file.
 */
export function RequestAccessPanel(): JSX.Element {
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
        setSubmitError('We couldn’t reach the BimDossier API. Please try again in a moment.');
      }
    }
  };

  if (submitted !== null) {
    return (
      <RequestAccessSuccess
        name={submitted.name}
        email={submitted.email}
        company={submitted.company}
        onReset={() => setSubmitted(null)}
      />
    );
  }

  return (
    <>
      <AuthFormIntro
        eyebrow="Request access"
        heading="Get your BimDossier demo."
        subtitle={
          <>
            Fill in the form with your work details — we&rsquo;ll review your request and send a
            personalised invite shortly.
          </>
        }
      />
      <RequestAccessForm
        onSubmit={onSubmit}
        submitError={submitError}
        defaultCountry="NL"
        signInHref="/login"
      />
    </>
  );
}
