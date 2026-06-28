'use client';

import { ArrowRight, Mail } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button, FormField, Input } from '@bimdossier/ui';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { apiClient } from '@/lib/api/client';

/**
 * Body content for the forgot-password page. The chrome (brand pane +
 * back-to-sign-in link) comes from `AuthLayoutShell` in the page file.
 */
export function ForgotPasswordPanel(): JSX.Element {
  const t = useTranslations('forgotPassword');
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setPending(true);
    try {
      await apiClient.postNoContent('/auth/forgot-password', '', { email });
    } catch {
      // Never leak whether the email exists — same posture as the API.
    } finally {
      setSubmitted(true);
      setPending(false);
    }
  };

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
      </form>
    </>
  );
}
