'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useId, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, Input } from '@bimstitch/ui';

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
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={emailId} className="text-label2 font-medium text-foreground">
          Email
        </label>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          invalid={usernameError !== undefined}
          {...form.register('username')}
        />
        {usernameError !== undefined ? (
          <span role="alert" className="text-body3 text-error">
            {usernameError}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-label2 font-medium text-foreground">
          Password
        </label>
        <Input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          invalid={passwordError !== undefined}
          {...form.register('password')}
        />
        {passwordError !== undefined ? (
          <span role="alert" className="text-body3 text-error">
            {passwordError}
          </span>
        ) : null}
      </div>

      {apiErrorMessage === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
        >
          {apiErrorMessage}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={login.isPending}
        className="mt-2"
      >
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
