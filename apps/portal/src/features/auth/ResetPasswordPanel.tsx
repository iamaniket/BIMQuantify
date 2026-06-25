'use client';

import { ArrowRight, Lock } from '@bimdossier/ui/icons';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button, FormField, Input } from '@bimdossier/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';

/**
 * Body content for the reset-password page. The chrome (brand pane +
 * back-to-sign-in link) comes from `AuthLayoutShell` in the page file.
 */
export function ResetPasswordPanel(): JSX.Element {
  const t = useTranslations('resetPassword');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const passwordId = useId();
  const confirmId = useId();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    setPending(true);
    try {
      await apiClient.postNoContent('/auth/reset-password', '', { token, password });
      router.replace('/login?reset=1');
    } catch {
      setError(t('errors.resetFailed'));
    } finally {
      setPending(false);
    }
  };

  const tokenMissing = token === null || token === '';

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('subtitle')} />
      {tokenMissing ? (
        <ErrorBanner message={t('errors.tokenMissing')} tone="soft" />
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-3.5">
          <FormField label={t('field.password')} htmlFor={passwordId}>
            <Input
              id={passwordId}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              leading={<Lock size={18} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <FormField label={t('field.passwordConfirm')} htmlFor={confirmId}>
            <Input
              id={confirmId}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              leading={<Lock size={18} />}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
        </form>
      )}
    </>
  );
}
