'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/i18n/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useId, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, FormField, Input } from '@bimstitch/ui';

import { useLogin } from '@/features/auth/useLogin';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/providers/AuthProvider';

const LoginFormSchema = z.object({
  username: z.string().min(1, { message: 'Email is required' }).email({ message: 'Email is invalid' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type LoginFormValues = z.infer<typeof LoginFormSchema>;

export function LoginForm(): JSX.Element {
  const router = useRouter();
  const { setTokens } = useAuth();
  const login = useLogin();
  const emailId = useId();
  const passwordId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { username: 'superadmin@bimstitch.dev', password: 'SuperAdmin123!' },
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
        return 'Invalid email or password';
      }
      return `Login failed: ${error.detail}`;
    }
    return 'Login failed. Please try again.';
  })();

  const usernameField = form.formState.errors.username;
  const passwordField = form.formState.errors.password;
  const usernameError = usernameField === undefined ? undefined : usernameField.message;
  const passwordError = passwordField === undefined ? undefined : passwordField.message;

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex w-full flex-col gap-3.5">
      <FormField label="Work email" htmlFor={emailId} error={usernameError}>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          placeholder="you@company.nl"
          invalid={usernameError !== undefined}
          leading={<Mail size={14} />}
          {...form.register('username')}
        />
      </FormField>

      <FormField
        label="Password"
        htmlFor={passwordId}
        error={passwordError}
        action={
          <a href="/forgot-password" className="text-[11px] font-semibold text-primary no-underline">
            Forgot?
          </a>
        }
      >
        <Input
          id={passwordId}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="••••••••"
          invalid={passwordError !== undefined}
          leading={<Lock size={14} />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
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
        <span className="text-[12.5px] text-foreground-secondary">Keep me signed in on this device</span>
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
        {login.isPending ? 'Signing in…' : (
          <>
            Sign in
            <ArrowRight size={14} />
          </>
        )}
      </Button>
    </form>
  );
}
