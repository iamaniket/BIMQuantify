'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type JSX } from 'react';
import { z } from 'zod';

import { Button, FormField, Input } from '@bimstitch/ui';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { useRouter } from '@/i18n/navigation';
import { apiClient, ApiError } from '@/lib/api/client';

const ResetResponseSchema = z.object({}).passthrough();

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
      await apiClient.post(
        '/auth/reset-password',
        { token, password },
        ResetResponseSchema,
        '',
      );
      router.replace('/login?reset=1');
    } catch (e) {
      if (e instanceof ApiError) {
        setError(t('errors.resetFailed'));
      } else {
        setError(t('errors.resetFailed'));
      }
    } finally {
      setPending(false);
    }
  };

  const tokenMissing = token === null || token === '';

  return (
    <>
      <AuthFormIntro eyebrow={t('eyebrow')} heading={t('title')} subtitle={t('subtitle')} />
      {tokenMissing ? (
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
        >
          {t('errors.tokenMissing')}
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-3.5">
          <FormField label={t('field.password')} htmlFor={passwordId}>
            <Input
              id={passwordId}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              leading={<Lock size={14} />}
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
              leading={<Lock size={14} />}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormField>
          {error !== null && (
            <div
              role="alert"
              className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
            >
              {error}
            </div>
          )}
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
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        </form>
      )}
    </>
  );
}
