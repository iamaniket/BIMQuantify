'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/i18n/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, FormField, Input } from '@bimstitch/ui';

import { useLogin } from '@/features/auth/useLogin';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/providers/AuthProvider';

const DEV_DEFAULTS = { username: 'superadmin@bimstitch.dev', password: 'SuperAdmin123!' };
const EMPTY_DEFAULTS = { username: '', password: '' };

type LoginFormValues = { username: string; password: string };

export function LoginForm(): JSX.Element {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const { setTokens } = useAuth();
  const login = useLogin();
  const emailId = useId();
  const passwordId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const schema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .min(1, { message: t('errors.emailRequired') })
          .email({ message: t('errors.emailInvalid') }),
        password: z.string().min(1, { message: t('errors.passwordRequired') }),
      }),
    [t],
  );

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: process.env.NODE_ENV === 'production' ? EMPTY_DEFAULTS : DEV_DEFAULTS,
    mode: 'onSubmit',
  });

  const onSubmit: SubmitHandler<LoginFormValues> = (values) => {
    login.mutate(values, {
      onSuccess: (tokens) => {
        setTokens(tokens);
        router.push('/projects');
      },
    });
  };

  const apiErrorMessage = ((): string | null => {
    const { error } = login;
    if (error === null) return null;
    if (error instanceof ApiError) {
      if (error.status === 400 || error.status === 401) {
        return t('errors.invalidCredentials');
      }
      return t('errors.loginFailedDetail', { detail: error.detail });
    }
    return t('errors.loginFailedGeneric');
  })();

  const usernameField = form.formState.errors.username;
  const passwordField = form.formState.errors.password;
  const usernameError = usernameField === undefined ? undefined : usernameField.message;
  const passwordError = passwordField === undefined ? undefined : passwordField.message;

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex w-full flex-col gap-3.5">
      <FormField label={t('emailLabel')} htmlFor={emailId} error={usernameError}>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          invalid={usernameError !== undefined}
          leading={<Mail size={14} />}
          {...form.register('username')}
        />
      </FormField>

      <FormField
        label={t('passwordLabel')}
        htmlFor={passwordId}
        error={passwordError}
        action={
          <a href="/forgot-password" className="text-[11px] font-semibold text-primary no-underline">
            {t('forgot')}
          </a>
        }
      >
        <Input
          id={passwordId}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder={t('passwordPlaceholder')}
          invalid={passwordError !== undefined}
          leading={<Lock size={14} />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="grid size-7 cursor-pointer place-items-center rounded text-foreground-tertiary hover:text-foreground"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          }
          {...form.register('password')}
        />
      </FormField>

      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-4 cursor-pointer accent-primary"
        />
        <span className="text-[12.5px] text-foreground-secondary">{t('rememberMe')}</span>
      </label>

      {apiErrorMessage === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error"
        >
          {apiErrorMessage}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={login.isPending}
        className="mt-1 flex items-center justify-center gap-2"
      >
        {login.isPending ? t('submitting') : (
          <>
            {t('submit')}
            <ArrowRight size={14} />
          </>
        )}
      </Button>
    </form>
  );
}
