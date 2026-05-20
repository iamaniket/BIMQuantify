'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button, FormField, Input } from '@bimstitch/ui';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';

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
    if (password !== confirm) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    setPending(true);
    try {
      await apiClient.postNoContent('/auth/activate', '', { token, password });
      router.replace('/login?activated=1');
    } catch {
      setError(t('errors.activationFailed'));
    } finally {
      setPending(false);
    }
  };

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
            {pending ? t('cta') : (
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
