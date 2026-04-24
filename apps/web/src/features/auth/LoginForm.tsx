'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useId, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

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
    defaultValues: { username: '', password: '' },
    mode: 'onSubmit',
  });

  const onSubmit: SubmitHandler<LoginFormValues> = (values) => {
    login.mutate(values, {
      onSuccess: (tokens) => {
        setTokens(tokens);
        router.push('/');
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

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4 w-full max-w-sm"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">Email</label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          className="border rounded px-3 py-2"
          {...form.register('username')}
        />
        {form.formState.errors.username ? (
          <span role="alert" className="text-sm text-red-600">
            {form.formState.errors.username.message}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={passwordId} className="text-sm font-medium">Password</label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          className="border rounded px-3 py-2"
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <span role="alert" className="text-sm text-red-600">
            {form.formState.errors.password.message}
          </span>
        ) : null}
      </div>

      {apiErrorMessage === null ? null : (
        <div role="alert" className="text-sm text-red-600">
          {apiErrorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={login.isPending}
        className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
