'use client';

import { ArrowRight, Lock } from '@bimdossier/ui/icons';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button, FormField, Input } from '@bimdossier/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { useRouter } from '@/i18n/navigation';
import { ApiError, apiClient } from '@/lib/api/client';

// Server-side minimum (auth/manager.py::MIN_PASSWORD_LENGTH). Checked client-side
// too so a too-short password gets clear feedback instead of the generic
// "link expired" message (the form is `noValidate`, so the input's minLength
// alone does not block submit).
const MIN_PASSWORD_LENGTH = 12;

/**
 * Activation form body. One call to POST /auth/activate { token, password }
 * which atomically marks the invited user verified and sets their password.
 * Surrounding chrome comes from `AuthLayoutShell` in the page file.
 */
export function ActivatePanel(): JSX.Element {
  const t = useTranslations('activate');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const passwordId = useId();
  const confirmId = useId();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tokenMissing = token === null || token === '';

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    setPending(true);
    try {
      await apiClient.postNoContent('/auth/activate', '', { token, password });
      router.replace('/login?activated=1');
    } catch (err) {
      // The server collapses several password rules into ACTIVATION_INVALID_PASSWORD;
      // show its real (localized) message instead of blaming the link.
      if (err instanceof ApiError && err.code === 'ACTIVATION_INVALID_PASSWORD') {
        setError(err.localizedMessage ?? t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
      } else {
        setError(t('errors.activationFailed'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('subtitle')} />
      {tokenMissing ? (
        <ErrorBanner message={t('errors.tokenMissing')} tone="soft" />
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-3.5">
          <FormField label={t('field.password')} htmlFor={passwordId} hint={t('field.passwordHint')}>
            <Input
              id={passwordId}
              type="password"
              required
              minLength={12}
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
              minLength={12}
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
            {pending ? t('cta') : (
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
