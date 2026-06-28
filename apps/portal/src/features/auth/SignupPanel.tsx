'use client';

import { ArrowRight, Mail } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button, FormField, Input } from '@bimdossier/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { Link } from '@/i18n/navigation';
import { ApiError, apiClient } from '@/lib/api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Free-tier signup body. One call to `POST /auth/signup { email, locale }`,
 * which is enumeration-safe (always 202) and emails an activation link. The
 * chrome (brand pane + back-to-sign-in) comes from `AuthLayoutShell`.
 *
 * `404` means the tier is off (FREE_TIER_ENABLED=false → route not mounted) —
 * we degrade to the request-access door instead of a dead end. `429` is the
 * per-IP signup limiter.
 */
export function SignupPanel(): JSX.Element {
  const t = useTranslations('signup');
  const locale = useLocale();
  const emailId = useId();

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (trimmed === '') {
      setError(t('errors.emailRequired'));
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setError(t('errors.emailInvalid'));
      return;
    }
    setPending(true);
    try {
      await apiClient.postNoContent('/auth/signup', '', { email: trimmed, locale });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setDisabled(true);
      } else if (err instanceof ApiError && err.status === 429) {
        setError(t('errors.rateLimited'));
      } else {
        setError(t('errors.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  if (disabled) {
    return (
      <>
        <AuthFormIntro
          eyebrow={t('eyebrow')}
          heading={t('disabledTitle')}
          subtitle={t('disabledBody')}
        />
        <Link href="/request-access">
          <Button
            variant="primary"
            size="md"
            className="mt-1 flex w-full items-center justify-center gap-2"
          >
            {t('requestAccessCta')}
          </Button>
        </Link>
      </>
    );
  }

  if (submitted) {
    return (
      <>
        <AuthFormIntro
          eyebrow={t('eyebrow')}
          heading={t('sentTitle')}
          subtitle={t('sentBody')}
        />
        <p className="text-sm">
          <Link href="/login" className="font-semibold text-primary no-underline">
            {t('backToLogin')}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('subtitle')} />
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-3.5">
        <FormField label={t('field.email')} htmlFor={emailId}>
          <Input
            id={emailId}
            type="email"
            required
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            leading={<Mail size={18} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <ErrorBanner message={error} tone="soft" />
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={pending}
          className="mt-1 flex items-center justify-center gap-2"
        >
          {pending ? t('submitting') : (
            <>
              {t('cta')}
              <ArrowRight size={18} />
            </>
          )}
        </Button>
        <p className="text-body3 text-foreground-tertiary">
          {t.rich('legal', {
            terms: (chunks) => (
              <Link
                href="/legal/terms"
                className="font-medium text-foreground-secondary no-underline hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href="/legal/privacy"
                className="font-medium text-foreground-secondary no-underline hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </form>
    </>
  );
}
